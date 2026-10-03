import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { coreImports } from './app.module';
import { redisConfig } from './config';

/**
 * The `npm run worker` process: BullMQ processors and event listeners, no
 * HTTP controllers (ch. 1 §1.5). Processors and the hourly prune scheduler
 * are added in phase 6.
 */
@Module({
  imports: [
    ...coreImports,
    BullModule.forRootAsync({
      inject: [redisConfig.KEY],
      useFactory: (config: ConfigType<typeof redisConfig>) => ({
        connection: { url: config.url },
      }),
    }),
  ],
})
export class WorkerModule {}
