import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import request from 'supertest';
import { PasswordBroker } from '../../src/accounts/password-broker.service';
import { DeniedToken } from '../../src/auth/denied-token.entity';
import {
  LoginLimiter,
  RedisLoginLimiterStore,
} from '../../src/auth/login-limiter.service';
import { USER_PRV, type TokenClaims } from '../../src/auth/token.service';
import { FakeClock } from '../../src/common/clock/fake-clock';
import { User } from '../../src/users/user.entity';
import { createApp, type TestApp } from '../support/create-app';
import { testRedisUrl } from '../support/redis';
import {
  json,
  body,
  type TokenBody,
  type UserBody,
  type ErrorBody,
} from '../support/json-request';

/** Behaviour beyond the ported Pest tests (ch. 5, ch. 7 §7.3). */
const redisUrl = testRedisUrl(12);

function decode(token: string): TokenClaims {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as TokenClaims;
}

describe('auth (ch. 5)', () => {
  let t: TestApp;
  let user: User;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(redisUrl);
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // The forgot-password cases go through the Redis-backed throttler.
    await redis.flushdb();
    t = await createApp({ env: { TRUSTED_PROXIES: '*', REDIS_URL: redisUrl } });
    user = await t.factories.user({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });
  });

  afterEach(async () => {
    await t.close();
  });

  const login = (
    body: object = {
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    },
  ) => json(t.http, 'post', '/api/v1/auth/login', body);
  const me = (token?: string) =>
    json(t.http, 'get', '/api/v1/auth/me', undefined, token);
  const refresh = (token: string) =>
    json(t.http, 'post', '/api/v1/auth/refresh', undefined, token);
  /** Signs arbitrary claims with the app's secret. */
  const sign = (claims: Record<string, unknown>, secret?: string) =>
    t.app.get(JwtService).sign(claims, secret ? { secret } : {});
  const now = () => Math.floor(t.clock.now().getTime() / 1000);
  const validClaims = (): Record<string, unknown> => ({
    iss: 'http://localhost/api/v1/auth/login',
    iat: now(),
    exp: now() + 3600,
    nbf: now(),
    jti: 'abcdefghijklmnop',
    sub: String(user.id),
    prv: USER_PRV,
    tv: 0,
  });

  describe('tokens', () => {
    it("carries tymon's claims, in tymon's order", async () => {
      const res = await login().expect(200);
      const claims = decode(body<TokenBody>(res).access_token);

      expect(Object.keys(claims)).toEqual([
        'iss',
        'iat',
        'exp',
        'nbf',
        'jti',
        'sub',
        'prv',
        'tv',
      ]);
      expect(claims).toMatchObject({
        iat: now(),
        nbf: now(),
        exp: now() + 3600,
        sub: String(user.id),
        prv: USER_PRV,
        tv: 0,
      });
      expect(claims.iss).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/api\/v1\/auth\/login$/,
      );
      expect(claims.jti).toMatch(/^[A-Za-z0-9]{16}$/);
      // php -r 'echo sha1("App\\Models\\User");'
      expect(USER_PRV).toBe('23bd5c8949f600adb39e701c400872db7a5976f7');
    });

    it.each([
      [
        'the Authorization header',
        (token: string) =>
          request(t.http)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${token}`),
      ],
      [
        '?token=',
        (token: string) =>
          request(t.http).get(`/api/v1/auth/me?token=${token}`),
      ],
      [
        'a body token field',
        (token: string) =>
          request(t.http).patch('/api/v1/auth/me').send({ token, name: 'Ada' }),
      ],
    ])('accepts a token from %s', async (_source, send) => {
      const token = await t.apiToken(user);
      const res = await send(token);
      expect(res.status).toBe(200);
      expect(body<UserBody>(res).data.id).toBe(user.id);
    });

    it('rejects a token issued in the future (iat), even for refresh', async () => {
      const token = sign({ ...validClaims(), iat: now() + 1 });
      await me(token).expect(401);
      await refresh(token).expect(401);
    });

    it('rejects a token before its nbf, and after its exp (no leeway)', async () => {
      await me(sign({ ...validClaims(), nbf: now() + 1 })).expect(401);
      await me(sign({ ...validClaims(), exp: now() })).expect(200);
      await me(sign({ ...validClaims(), exp: now() - 1 })).expect(401);
    });

    it.each(['iss', 'iat', 'exp', 'nbf', 'sub', 'jti'])(
      'rejects a token without %s',
      async (claim) => {
        const claims = validClaims();
        delete claims[claim];
        await me(sign(claims)).expect(401);
      },
    );

    it('rejects another secret, another subject model, and a deleted user', async () => {
      await me(sign(validClaims(), 'another-secret')).expect(401);
      await me(sign({ ...validClaims(), prv: 'another-model' })).expect(401);
      await me(sign({ ...validClaims(), sub: '999' })).expect(401);

      const token = await t.apiToken(user);
      await t.dataSource.getRepository(User).delete({ id: user.id });
      await me(token).expect(401);
    });

    it('accepts a token without prv, and treats a missing tv as version 0', async () => {
      const claims = validClaims();
      delete claims.prv;
      delete claims.tv;
      await me(sign(claims)).expect(200);

      await t.dataSource
        .getRepository(User)
        .update({ id: user.id }, { tokenVersion: 1 });
      await me(sign(claims)).expect(401);
    });
  });

  describe('refresh', () => {
    it('keeps iat, sub, prv and tv, and issues a fresh jti, nbf, exp and iss', async () => {
      const token = body<TokenBody>(await login().expect(200)).access_token;
      const old = decode(token);
      t.clock.travel(90 * 60_000);

      const res = await refresh(token).expect(200);
      const claims = decode(body<TokenBody>(res).access_token);

      expect(claims).toMatchObject({
        iat: old.iat,
        sub: old.sub,
        prv: old.prv,
        tv: old.tv,
        nbf: now(),
        exp: now() + 3600,
      });
      expect(claims.jti).not.toBe(old.jti);
      expect(claims.iss).toMatch(/\/api\/v1\/auth\/refresh$/);
      expect(res.body).toMatchObject({
        token_type: 'bearer',
        expires_in: 3600,
      });
    });

    it('denies the new token too when the old one was revoked', async () => {
      const token = await t.apiToken(user);
      await t.dataSource
        .getRepository(User)
        .update({ id: user.id }, { tokenVersion: 1 });

      await refresh(token).expect(401);
      expect(await t.dataSource.getRepository(DeniedToken).count()).toBe(2);
    });

    it('refuses a token that was already refreshed', async () => {
      const token = await t.apiToken(user);
      await refresh(token).expect(200);
      await refresh(token).expect(401);
    });
  });

  describe('login throttling', () => {
    const fail = () => login({ email: 'owner@example.com', password: 'wrong' });

    it('answers 429 with the seconds left in the window, which later failures do not extend', async () => {
      for (let i = 0; i < 5; i++) await fail().expect(422);

      const res = await login();
      expect(res.status).toBe(429);
      const message =
        'Too many login attempts. Please try again in 60 seconds.';
      expect(res.body).toEqual({ message, errors: { email: [message] } });

      t.clock.travel(45_000);
      expect(body<ErrorBody>(await fail()).errors.email).toEqual([
        'Too many login attempts. Please try again in 15 seconds.',
      ]);

      t.clock.travel(15_000);
      await login().expect(200);
    });

    it("returns the credentials error with Laravel's exact body", async () => {
      const message = 'These credentials do not match our records.';
      expect((await fail()).body).toEqual({
        message,
        errors: { email: [message] },
      });
    });

    it('keys on the email and the Symfony-ordered client IP', async () => {
      const from = (forwarded: string) =>
        login({ email: 'owner@example.com', password: 'wrong' }).set(
          'X-Forwarded-For',
          forwarded,
        );
      // A faked leftmost entry doesn't change ip(), which is the last one.
      for (let i = 0; i < 5; i++) await from(`9.9.9.${i}, 1.1.1.1`).expect(422);
      await from('8.8.8.8, 1.1.1.1').expect(429);
      await from('2.2.2.2').expect(422);
    });
  });

  describe('accounts', () => {
    it('issues the new token with the bumped tv and denies the presented one', async () => {
      const token = await t.apiToken(user);
      const res = await json(
        t.http,
        'put',
        '/api/v1/auth/password',
        {
          current_password: 'correct-horse-battery-staple',
          password: 'a-brand-new-passphrase',
          password_confirmation: 'a-brand-new-passphrase',
        },
        token,
      ).expect(200);

      expect(decode(body<TokenBody>(res).access_token).tv).toBe(1);
      const denied = await t.dataSource.getRepository(DeniedToken).find();
      expect(denied.map((row) => row.jti)).toEqual([decode(token).jti]);
    });

    it('validates profile updates with Laravel messages', async () => {
      const token = await t.apiToken(user);
      const res = await json(
        t.http,
        'patch',
        '/api/v1/auth/me',
        {
          name: '',
          email: 'NOT AN EMAIL',
        },
        token,
      ).expect(422);

      expect(res.body).toEqual({
        message: 'The name field is required. (and 1 more error)',
        errors: {
          name: ['The name field is required.'],
          email: ['The email field must be a valid email address.'],
        },
      });
    });

    it('deletes an account that owns nothing', async () => {
      const token = await t.apiToken(user);
      await json(
        t.http,
        'delete',
        '/api/v1/auth/me',
        {
          password: 'correct-horse-battery-staple',
        },
        token,
      ).expect(204);
      expect(await t.dataSource.getRepository(User).count()).toBe(0);
    });
  });

  describe('password reset', () => {
    const forgot = () =>
      json(t.http, 'post', '/api/v1/auth/forgot-password', {
        email: 'owner@example.com',
      }).expect(200);

    it('sends at most one link per 60 seconds', async () => {
      await forgot();
      await forgot();
      expect(t.mail.sent).toHaveLength(1);

      t.clock.travel(61_000);
      await forgot();
      expect(t.mail.sent).toHaveLength(2);
      expect(t.mail.sent[0].subject).toBe('Reset your password');
    });

    it('rejects a token older than 60 minutes', async () => {
      const token = await t.app.get(PasswordBroker).createToken(user);
      t.clock.travel(60 * 60_000 + 1000);

      const res = await json(t.http, 'post', '/api/v1/auth/reset-password', {
        token,
        email: 'owner@example.com',
        password: 'a-brand-new-passphrase',
        password_confirmation: 'a-brand-new-passphrase',
      });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        message: 'This password reset token is invalid.',
        errors: { email: ['This password reset token is invalid.'] },
      });
    });
  });
});

describe('RedisLoginLimiterStore (Laravel RateLimiter on Redis)', () => {
  let redis: Redis;
  let clock: FakeClock;
  let limiter: LoginLimiter;

  beforeAll(() => {
    redis = new Redis(redisUrl);
  });

  beforeEach(async () => {
    await redis.flushdb();
    clock = new FakeClock(new Date());
    limiter = new LoginLimiter(new RedisLoginLimiterStore(redis, clock), clock);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('counts failures in a fixed window and reports the seconds left', async () => {
    const key = limiter.key('owner@example.com', '1.1.1.1');
    expect(key).toMatch(/^login:[0-9a-f]{40}$/);

    for (let i = 0; i < 5; i++) {
      expect(await limiter.tooManyAttempts(key)).toBe(false);
      await limiter.hit(key);
    }
    expect(await limiter.tooManyAttempts(key)).toBe(true);
    expect(await limiter.availableIn(key)).toBe(60);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(60);

    clock.travel(20_000);
    await limiter.hit(key);
    expect(await limiter.availableIn(key)).toBe(40);
    expect(await redis.get(key)).toBe('6');

    await limiter.clear(key);
    expect(await limiter.tooManyAttempts(key)).toBe(false);
    expect(await redis.exists(key, `${key}:timer`)).toBe(0);
  });

  it('resets a count whose timer has expired', async () => {
    const key = limiter.key('owner@example.com', '1.1.1.1');
    for (let i = 0; i < 5; i++) await limiter.hit(key);
    await redis.del(`${key}:timer`);

    expect(await limiter.tooManyAttempts(key)).toBe(false);
    expect(await redis.exists(key)).toBe(0);
  });
});
