import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { DeniedToken } from './denied-token.entity';
import { TokenService, type TokenClaims } from './token.service';

const MINUTE = 60_000;

/**
 * tymon's `Blacklist` over `App\Providers\Jwt\DatabaseStorage` (ch. 5 §5.5):
 * the `denied_tokens` table, never a cache. No grace period.
 */
@Injectable()
export class DenyListService {
  constructor(
    @InjectRepository(DeniedToken)
    private readonly tokens: Repository<DeniedToken>,
    private readonly tokenService: TokenService,
    private readonly clock: Clock,
  ) {}

  /**
   * `Blacklist::add()`: skipped when already actively denied. The row lives
   * until the later of `exp` and `iat + JWT_REFRESH_TTL`, plus a minute,
   * counted in whole minutes from now.
   */
  async add(claims: TokenClaims): Promise<void> {
    if ((await this.active(claims.jti)) !== null) return;

    const now = this.clock.now();
    const until =
      Math.max(
        claims.exp * 1000,
        claims.iat * 1000 + this.tokenService.refreshTtlMinutes * MINUTE,
      ) + MINUTE;
    const minutes = Math.ceil(Math.abs(until - now.getTime()) / MINUTE);
    const value = { valid_until: Math.floor(now.getTime() / 1000) };
    const expiresAt = new Date(now.getTime() + minutes * MINUTE);

    // `updateOrCreate`: an expired row for the same jti is overwritten.
    const existing = await this.tokens.findOneBy({ jti: claims.jti });
    if (existing) {
      await this.tokens.update({ jti: claims.jti }, { value, expiresAt });
    } else {
      await this.tokens.insert({
        jti: claims.jti,
        value,
        expiresAt,
        createdAt: now,
      });
    }
  }

  /** `Blacklist::has()`: an active row whose `valid_until` has been reached. */
  async isDenied(jti: string): Promise<boolean> {
    const row = await this.active(jti);
    if (row === null) return false;
    if (row.value === 'forever') return true;
    const validUntil = (row.value as { valid_until?: unknown } | null)
      ?.valid_until;
    return (
      typeof validUntil === 'number' &&
      validUntil <= this.tokenService.nowSeconds()
    );
  }

  /** `model:prune` for `DeniedToken`: rows whose `expires_at` has passed. */
  async prune(): Promise<number> {
    const result = await this.tokens.delete({
      expiresAt: LessThanOrEqual(this.clock.now()),
    });
    return result.affected ?? 0;
  }

  /** `DeniedToken::active()->find($jti)`. */
  private active(jti: string): Promise<DeniedToken | null> {
    return this.tokens.findOne({
      where: [
        { jti, expiresAt: IsNull() },
        { jti, expiresAt: MoreThan(this.clock.now()) },
      ],
    });
  }
}
