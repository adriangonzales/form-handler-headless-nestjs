import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * Laravel's `RateLimiter` + `ThrottleRequests` on Redis, as one atomic script:
 * `tooManyAttempts()` is checked **before** the hit, so a rejected request is
 * not counted and never extends the lockout; the window is fixed from the
 * first hit and its `:timer` key gives `Retry-After` (`availableIn()`).
 *
 * Replaces `@nest-lab/throttler-storage-redis`, whose script (with the
 * `blockDuration: 1` the guide proposed) resets the counter when a request
 * lands while the 1 ms block key has a PTTL of 0, reopening the window.
 */
const SCRIPT = `
local counter = KEYS[1]
local timer = KEYS[2]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local hits = tonumber(redis.call('GET', counter) or '0')
if hits >= limit then
  local left = redis.call('PTTL', timer)
  if left > 0 then
    return {hits, left, 1}
  end
  redis.call('DEL', counter)
end
redis.call('SET', timer, '1', 'PX', ttl, 'NX')
local added = redis.call('SET', counter, '0', 'PX', ttl, 'NX')
hits = redis.call('INCR', counter)
if (not added) and hits == 1 then
  redis.call('SET', counter, '1', 'PX', ttl)
end
return {hits, redis.call('PTTL', timer), 0}
`.trim();

export class LaravelRateLimiterStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  /** `ttl` is in milliseconds; `blockDuration` is ignored (the window is the lockout). */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, leftMs, blocked] = (await this.redis.eval(
      SCRIPT,
      2,
      base,
      `${base}:timer`,
      limit,
      ttl,
    )) as [number, number, number];
    const seconds = Math.max(0, Math.ceil(leftMs / 1000));
    return {
      totalHits: hits,
      timeToExpire: seconds,
      isBlocked: blocked === 1,
      timeToBlockExpire: blocked === 1 ? seconds : 0,
    };
  }
}
