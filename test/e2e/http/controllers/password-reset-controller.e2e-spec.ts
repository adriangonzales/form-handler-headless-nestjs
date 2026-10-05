import { compareSync } from 'bcrypt';
import Redis from 'ioredis';
import { PasswordResetToken } from '../../../../src/accounts/password-reset-token.entity';
import { PasswordBroker } from '../../../../src/accounts/password-broker.service';
import { User } from '../../../../src/users/user.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import { testRedisUrl } from '../../../support/redis';
import {
  json,
  validationErrorKeys,
  body,
  type ErrorBody,
} from '../../../support/json-request';

/**
 * Port of `tests/Feature/Http/Controllers/PasswordResetControllerTest.php`
 * (6). The `password` throttler runs on the real Redis (DB 13), flushed
 * between tests.
 */
const redisUrl = testRedisUrl(13);

describe('PasswordResetControllerTest', () => {
  let t: TestApp;
  let redis: Redis;
  let user: User;

  beforeAll(() => {
    redis = new Redis(redisUrl);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    await redis.flushdb();
    t = await createApp({
      env: {
        PASSWORD_RESET_URL: 'https://app.example.com/reset-password',
        REDIS_URL: redisUrl,
      },
    });
    user = await t.factories.user({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });
  });

  afterEach(async () => {
    await t.close();
  });

  const forgot = (email: string) =>
    json(t.http, 'post', '/api/v1/auth/forgot-password', { email });
  const reset = (body: object) =>
    json(t.http, 'post', '/api/v1/auth/reset-password', body);
  const createToken = () => t.app.get(PasswordBroker).createToken(user);
  const passwordMatches = async (plain: string) =>
    compareSync(
      plain,
      (await t.dataSource.getRepository(User).findOneByOrFail({ id: user.id }))
        .password,
    );

  it('emails a reset link pointing at the client application', async () => {
    const res = await forgot('Owner@Example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message:
        'If an account exists for that email, a password reset link has been sent.',
    });
    const [mail, ...others] = t.mail.sentTo('owner@example.com');
    expect(others).toHaveLength(0);
    const url = /Reset Password: (\S+)/.exec(mail.text)?.[1] ?? '';
    const token = new URL(url).searchParams.get('token') ?? '';
    expect(url).toBe(
      `https://app.example.com/reset-password?token=${token}&email=owner%40example.com`,
    );
    const row = await t.dataSource
      .getRepository(PasswordResetToken)
      .findOneByOrFail({ email: 'owner@example.com' });
    expect(compareSync(token, row.token)).toBe(true);
  });

  it('gives the same response for an unknown email without sending anything', async () => {
    const res = await forgot('nobody@example.com');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message:
        'If an account exists for that email, a password reset link has been sent.',
    });
    expect(t.mail.sent).toHaveLength(0);
  });

  it('resets the password with a valid token and revokes existing tokens', async () => {
    const existingToken = await t.apiToken(user);
    const resetToken = await createToken();

    const res = await reset({
      token: resetToken,
      email: 'Owner@Example.com',
      password: 'a-brand-new-passphrase',
      password_confirmation: 'a-brand-new-passphrase',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Your password has been reset.' });

    expect(await passwordMatches('a-brand-new-passphrase')).toBe(true);

    await json(
      t.http,
      'get',
      '/api/v1/auth/me',
      undefined,
      existingToken,
    ).expect(401);

    await json(t.http, 'post', '/api/v1/auth/login', {
      email: 'owner@example.com',
      password: 'a-brand-new-passphrase',
    }).expect(200);
  });

  it.each([
    ['bad token', 'owner@example.com', false],
    ['unknown email', 'nobody@example.com', true],
  ])(
    'rejects a reset with a bad token or unknown email using the same message (%s)',
    async (_name, email, validToken) => {
      const token = validToken ? await createToken() : 'not-a-real-token';

      const res = await reset({
        token,
        email,
        password: 'a-brand-new-passphrase',
        password_confirmation: 'a-brand-new-passphrase',
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors.email).toEqual([
        'This password reset token is invalid.',
      ]);

      expect(await passwordMatches('correct-horse-battery-staple')).toBe(true);
    },
  );

  it('rejects a reset whose new password is not confirmed', async () => {
    const res = await reset({
      token: await createToken(),
      email: 'owner@example.com',
      password: 'a-brand-new-passphrase',
      password_confirmation: 'different',
    });

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain('password');
  });

  it('throttles password reset requests', async () => {
    for (let i = 0; i < 6; i++) {
      await forgot('nobody@example.com').expect(200);
    }

    await forgot('nobody@example.com').expect(429);
  });
});
