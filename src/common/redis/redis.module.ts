import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConfig } from '../../config';

/**
 * The shared `ioredis` connection used by the throttler storage and the login
 * limiter (ch. 1 §1.1). BullMQ opens its own connections, because blocking
 * workers can't share one.
 */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) =>
        // Lazy, so booting the HTTP app (and tests) doesn't need Redis until
        // something uses it.
        new Redis(config.url, { lazyConnect: true }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}
