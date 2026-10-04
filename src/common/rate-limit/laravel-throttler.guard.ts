import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { ThrottleRequestsException } from '../http/laravel-exceptions';
import { clientIp } from '../http/trust-proxy';

/**
 * `@nestjs/throttler`'s guard with Laravel's keys and response (ch. 3 §3.2).
 * Applied per route through `@RateLimited()`, never globally.
 */
@Injectable()
export class LaravelThrottlerGuard extends ThrottlerGuard {
  /** Laravel's `$request->ip()`: each exact address (no IPv6 /64 grouping). */
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(clientIp(req as unknown as Request));
  }

  /**
   * Only the throttler name and tracker, so routes sharing a throttler
   * (forgot and reset password) share one counter.
   */
  protected override generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return createHash('sha1').update(`${name}|${tracker}`).digest('hex');
  }

  /** 429 "Too Many Attempts." with `Retry-After` = seconds left in the window. */
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottleRequestsException(detail.timeToExpire);
  }
}
