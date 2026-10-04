import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { LaravelThrottlerGuard } from './laravel-throttler.guard';
import { Throttler, type ThrottlerName } from './throttlers';

/**
 * Applies the named rate limits to a route; every other throttler is skipped.
 * Put it on handlers whose guard order matters (public submissions) so it
 * runs before the form lookup: unknown IDs are counted, and 429 precedes 404.
 */
export function RateLimited(
  ...names: ThrottlerName[]
): MethodDecorator & ClassDecorator {
  const skip = Object.fromEntries(
    Object.values(Throttler)
      .filter((name) => !names.includes(name))
      .map((name) => [name, true]),
  );
  return applyDecorators(UseGuards(LaravelThrottlerGuard), SkipThrottle(skip));
}
