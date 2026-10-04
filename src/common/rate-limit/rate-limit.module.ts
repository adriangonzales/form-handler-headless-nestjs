import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { LaravelRateLimiterStorage } from './laravel-rate-limiter.storage';
import { THROTTLERS } from './throttlers';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: THROTTLERS,
        storage: new LaravelRateLimiterStorage(redis),
        errorMessage: 'Too Many Attempts.',
        // No X-RateLimit-* headers: neither client reads them (documented difference).
        setHeaders: false,
      }),
    }),
  ],
})
export class RateLimitModule {}
