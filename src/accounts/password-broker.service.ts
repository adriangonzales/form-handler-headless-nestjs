import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { httpBuildQuery } from '../common/http/http-build-query';
import { strRandom } from '../common/support/str';
import { timebox } from '../common/support/timebox';
import { appConfig } from '../config';
import { Mailer } from '../mail/mailer';
import { PasswordHasher } from '../users/password-hasher';
import { User } from '../users/user.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { resetPasswordMail } from './reset-password.mail';

/** `auth.passwords.users.expire` and `throttle`, in seconds. */
const EXPIRE_SECONDS = 60 * 60;
const THROTTLE_SECONDS = 60;
/** `PasswordBroker::$timeboxDuration` (200 ms). */
const TIMEBOX_US = 200_000;

export type SendResult = 'sent' | 'invalid-user' | 'throttled';
export type ResetResult = 'reset' | 'invalid-user' | 'invalid-token';

/**
 * Laravel's `PasswordBroker` + `DatabaseTokenRepository` (ch. 5 §5.10): one
 * bcrypt-hashed token per email in `password_reset_tokens`, valid for 60
 * minutes, at most one new link per 60 seconds.
 */
@Injectable()
export class PasswordBroker {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PasswordResetToken)
    private readonly tokens: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** `Password::sendResetLink()`. The caller answers the same either way. */
  sendResetLink(email: string): Promise<SendResult> {
    return timebox(TIMEBOX_US, async () => {
      const user = await this.users.findOneBy({ email });
      if (user === null) return 'invalid-user';
      if (await this.recentlyCreatedToken(user)) return 'throttled';

      const token = await this.createToken(user);
      await this.mailer.send(
        resetPasswordMail(user.email, this.resetUrl(user, token)),
      );
      return 'sent';
    });
  }

  /**
   * `Password::reset()`: on a valid token, `apply` saves the new password,
   * then the token row is deleted.
   */
  reset(
    email: string,
    token: string,
    apply: (user: User) => Promise<void>,
  ): Promise<ResetResult> {
    return timebox(TIMEBOX_US, async (box) => {
      const user = await this.users.findOneBy({ email });
      if (user === null) return 'invalid-user';
      if (!(await this.tokenExists(user, token))) return 'invalid-token';

      await apply(user);
      await this.deleteToken(user.email);
      box.returnEarly();
      return 'reset';
    });
  }

  /** `DatabaseTokenRepository::create()`: replaces any existing row. */
  async createToken(user: User): Promise<string> {
    const token = createHmac('sha256', this.hashKey())
      .update(strRandom(40))
      .digest('hex');
    const hashed = await this.hasher.make(token);
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(PasswordResetToken, { email: user.email });
      await manager.insert(PasswordResetToken, {
        email: user.email,
        token: hashed,
        createdAt: this.clock.now(),
      });
    });
    return token;
  }

  async deleteToken(email: string): Promise<void> {
    await this.tokens.delete({ email });
  }

  /** `ResetPassword::createUrlUsing()` in `AppServiceProvider`. */
  resetUrl(user: User, token: string): string {
    return `${this.config.passwordResetUrl}?${httpBuildQuery(
      { token, email: user.email },
      'rfc1738',
    )}`;
  }

  private async tokenExists(user: User, token: string): Promise<boolean> {
    const record = await this.tokens.findOneBy({ email: user.email });
    if (record === null) return false;
    const expired =
      this.createdAt(record) + EXPIRE_SECONDS * 1000 <
      this.clock.now().getTime();
    return !expired && (await this.hasher.check(token, record.token));
  }

  private async recentlyCreatedToken(user: User): Promise<boolean> {
    const record = await this.tokens.findOneBy({ email: user.email });
    return (
      record !== null &&
      this.createdAt(record) + THROTTLE_SECONDS * 1000 >
        this.clock.now().getTime()
    );
  }

  /** `Carbon::parse(null)` is "now". */
  private createdAt(record: PasswordResetToken): number {
    return (record.createdAt ?? this.clock.now()).getTime();
  }

  /** `PasswordBrokerManager`: `app.key`, base64-decoded when prefixed. */
  private hashKey(): Buffer {
    const key = this.config.key;
    return key.startsWith('base64:')
      ? Buffer.from(key.slice(7), 'base64')
      : Buffer.from(key);
  }
}
