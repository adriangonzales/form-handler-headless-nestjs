import Redis from 'ioredis';
import request from 'supertest';
import { LaravelRateLimiterStorage } from '../../src/common/rate-limit/laravel-rate-limiter.storage';
import { createApp, type TestApp } from '../support/create-app';
import { probeImports } from '../support/probe.module';

/**
 * Rate limiting (ch. 3 §3.2, ch. 7 §7.3) against a real Redis (REDIS_URL,
 * DB 15 by default), flushed between tests.
 */
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/15';

describe('LaravelRateLimiterStorage (Laravel RateLimiter semantics)', () => {
  let redis: Redis;
  let storage: LaravelRateLimiterStorage;

  beforeAll(() => {
    redis = new Redis(redisUrl);
    storage = new LaravelRateLimiterStorage(redis);
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  const hit = (ttlMs = 60_000, limit = 3) =>
    storage.increment('k', ttlMs, limit, 1, 't');

  it('allows `limit` hits, then blocks with the seconds left in the window', async () => {
    for (let i = 1; i <= 3; i++) {
      expect(await hit()).toMatchObject({ totalHits: i, isBlocked: false });
    }
    const blocked = await hit();
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToExpire).toBeGreaterThan(55);
    expect(blocked.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('does not count blocked requests or extend the window', async () => {
    for (let i = 0; i < 3; i++) await hit(1500);
    const first = await hit(1500);
    for (let i = 0; i < 20; i++) await hit(1500);
    expect(await redis.get('throttle:t:k')).toBe('3');
    const pttl = await redis.pttl('throttle:t:k:timer');
    expect(pttl).toBeLessThanOrEqual(1500);
    expect(first.isBlocked).toBe(true);
  });

  it('opens a fresh window once the timer expires', async () => {
    for (let i = 0; i < 4; i++) await hit(300);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await hit(300)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('never reopens the window under a sustained burst', async () => {
    // @nest-lab/throttler-storage-redis with blockDuration: 1 let 16,236 of
    // 124,400 requests through a 6/min limit in 3 s (reproduced 2026-10-04).
    let allowed = 0;
    const end = Date.now() + 1000;
    while (Date.now() < end) {
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          storage.increment('k', 60_000, 6, 1, 't'),
        ),
      );
      allowed += results.filter((r) => !r.isBlocked).length;
    }
    expect(allowed).toBe(6);
  });
});

describe('@RateLimited routes', () => {
  let t: TestApp;
  let redis: Redis;

  beforeAll(async () => {
    t = await createApp({
      imports: probeImports,
      env: { TRUSTED_PROXIES: '*' },
    });
    redis = new Redis(redisUrl);
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
    await t.close();
  });

  const submit = (form: string, ip = '1.1.1.1') =>
    request(t.http)
      .post(`/api/v1/probe-limits/forms/${form}/submissions`)
      .set('X-Forwarded-For', ip);

  it('submissions-form: 60 per form and IP, then 429 with Retry-After and no X-RateLimit-*', async () => {
    for (let i = 0; i < 60; i++) await submit('known').expect(201);
    const res = await submit('known').expect(429);
    expect(res.body).toEqual({ message: 'Too Many Attempts.' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(50);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(
      Object.keys(res.headers).filter((h) => h.startsWith('x-ratelimit')),
    ).toEqual([]);

    // Another form, or another IP, has its own counter.
    await submit('other').expect(404);
    await submit('known', '2.2.2.2').expect(201);
  });

  it('counts unknown form IDs, and 429 comes before 404', async () => {
    for (let i = 0; i < 60; i++) await submit('missing').expect(404);
    await submit('missing').expect(429);
  });

  it('a request rejected by submissions-form still counts toward submissions-ip', async () => {
    for (let i = 0; i < 61; i++) await submit('known');
    const keys = await redis.keys('throttle:submissions-ip:*');
    const counter = keys.find((key) => !key.endsWith(':timer'));
    expect(await redis.get(counter ?? '')).toBe('61');
  });

  it('keys on the Symfony-ordered client IP, not a faked leftmost X-Forwarded-For entry', async () => {
    for (let i = 0; i < 60; i++)
      await submit('known', `9.9.9.${i}, 1.1.1.1`).expect(201);
    await submit('known', '8.8.8.8, 1.1.1.1').expect(429);
  });

  it('forgot and reset password share one counter of 6 per minute (F9: not the submissions one)', async () => {
    for (let i = 0; i < 6; i++) await submit('known');
    for (let i = 0; i < 3; i++) {
      await request(t.http)
        .post('/api/v1/probe-limits/forgot-password')
        .set('X-Forwarded-For', '1.1.1.1')
        .expect(200);
      await request(t.http)
        .post('/api/v1/probe-limits/reset-password')
        .set('X-Forwarded-For', '1.1.1.1')
        .expect(200);
    }
    await request(t.http)
      .post('/api/v1/probe-limits/forgot-password')
      .set('X-Forwarded-For', '1.1.1.1')
      .expect(429);
    await request(t.http)
      .post('/api/v1/probe-limits/reset-password')
      .set('X-Forwarded-For', '1.1.1.1')
      .expect(429);
  });
});
