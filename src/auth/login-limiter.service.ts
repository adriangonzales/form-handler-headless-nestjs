import { Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock/clock';
import { REDIS } from '../common/redis/redis.module';
import { cleanRateLimiterKey, strTransliterate } from '../common/support/str';

/**
 * Laravel's `RateLimiter` (a fixed window) for login failures (ch. 5 §5.4).
 * The throttler storage can't do this: login counts only failures and clears
 * the count on success.
 */
export abstract class LoginLimiterStore {
  /** The counter, or 0. */
  abstract attempts(key: string): Promise<number>;
  abstract timerExists(key: string): Promise<boolean>;
  /** The timer's value: the Unix second the window ends. */
  abstract timer(key: string): Promise<number | null>;
  /** Starts the window at the first hit; returns the new count. */
  abstract hit(key: string, decaySeconds: number): Promise<number>;
  abstract resetAttempts(key: string): Promise<void>;
  abstract clear(key: string): Promise<void>;
}

/**
 * `RateLimiter::increment()` as one script: the `:timer` key (holding the
 * window's end) and the counter both expire with the window; later hits never
 * extend it.
 */
const HIT = `
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[1], 'NX')
local added = redis.call('SET', KEYS[1], '0', 'EX', ARGV[1], 'NX')
local hits = redis.call('INCR', KEYS[1])
if (not added) and hits == 1 then
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[1])
end
return hits
`.trim();

export class RedisLoginLimiterStore extends LoginLimiterStore {
  constructor(
    private readonly redis: Redis,
    private readonly clock: Clock,
  ) {
    super();
  }

  async attempts(key: string): Promise<number> {
    return Number((await this.redis.get(key)) ?? 0);
  }

  async timerExists(key: string): Promise<boolean> {
    return (await this.redis.exists(`${key}:timer`)) === 1;
  }

  async timer(key: string): Promise<number | null> {
    const value = await this.redis.get(`${key}:timer`);
    return value === null ? null : Number(value);
  }

  async hit(key: string, decaySeconds: number): Promise<number> {
    const availableAt =
      Math.floor(this.clock.now().getTime() / 1000) + decaySeconds;
    return Number(
      await this.redis.eval(
        HIT,
        2,
        key,
        `${key}:timer`,
        decaySeconds,
        availableAt,
      ),
    );
  }

  async resetAttempts(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(key, `${key}:timer`);
  }
}

/**
 * The same semantics in memory, expiring by the `Clock` (Laravel's `array`
 * cache store in tests). `flush()` is `Cache::flush()`.
 */
export class InMemoryLoginLimiterStore extends LoginLimiterStore {
  private readonly entries = new Map<
    string,
    { value: number; expiresAt: number }
  >();

  constructor(private readonly clock: Clock) {
    super();
  }

  attempts(key: string): Promise<number> {
    return Promise.resolve(this.get(key) ?? 0);
  }

  timerExists(key: string): Promise<boolean> {
    return Promise.resolve(this.get(`${key}:timer`) !== null);
  }

  timer(key: string): Promise<number | null> {
    return Promise.resolve(this.get(`${key}:timer`));
  }

  hit(key: string, decaySeconds: number): Promise<number> {
    const now = this.now();
    const add = (k: string, value: number) => {
      if (this.get(k) !== null) return false;
      this.entries.set(k, { value, expiresAt: now + decaySeconds });
      return true;
    };
    add(`${key}:timer`, now + decaySeconds);
    const added = add(key, 0);
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(0);
    entry.value += 1;
    if (!added && entry.value === 1) entry.expiresAt = now + decaySeconds;
    return Promise.resolve(entry.value);
  }

  resetAttempts(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  clear(key: string): Promise<void> {
    this.entries.delete(key);
    this.entries.delete(`${key}:timer`);
    return Promise.resolve();
  }

  flush(): void {
    this.entries.clear();
  }

  private get(key: string): number | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  private now(): number {
    return Math.floor(this.clock.now().getTime() / 1000);
  }
}

@Injectable()
export class LoginLimiter {
  static readonly MAX_ATTEMPTS = 5;
  static readonly DECAY_SECONDS = 60;

  constructor(
    private readonly store: LoginLimiterStore,
    private readonly clock: Clock,
  ) {}

  /**
   * `Str::transliterate(lower(email) . '|' . ip())`, cleaned as Laravel's
   * `RateLimiter` does, then hashed so user input never forms a Redis key.
   */
  key(email: string, ip: string): string {
    const raw = cleanRateLimiterKey(strTransliterate(`${email}|${ip}`));
    return `login:${createHash('sha1').update(raw).digest('hex')}`;
  }

  /** `RateLimiter::tooManyAttempts()`: resets a count whose window has gone. */
  async tooManyAttempts(key: string): Promise<boolean> {
    if ((await this.store.attempts(key)) >= LoginLimiter.MAX_ATTEMPTS) {
      if (await this.store.timerExists(key)) return true;
      await this.store.resetAttempts(key);
    }
    return false;
  }

  /** `RateLimiter::availableIn()`: seconds left in the window, at least 0. */
  async availableIn(key: string): Promise<number> {
    const timer = (await this.store.timer(key)) ?? 0;
    return Math.max(0, timer - Math.floor(this.clock.now().getTime() / 1000));
  }

  async hit(key: string): Promise<void> {
    await this.store.hit(key, LoginLimiter.DECAY_SECONDS);
  }

  async clear(key: string): Promise<void> {
    await this.store.clear(key);
  }
}

export const loginLimiterStoreProvider = {
  provide: LoginLimiterStore,
  inject: [REDIS, Clock],
  useFactory: (redis: Redis, clock: Clock) =>
    new RedisLoginLimiterStore(redis, clock),
};
