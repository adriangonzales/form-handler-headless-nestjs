import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RouterModule } from '@nestjs/core';
import { ApiV1Module } from './api/api-v1.module';
import { ClockModule } from './common/clock/clock.module';
import { RedisModule } from './common/redis/redis.module';
import { configLoaders, validateEnv } from './config';
import { DatabaseModule } from './database/database.module';
import { RootController } from './root.controller';

/** Modules shared by the HTTP app and the worker. */
export const coreImports = [
  ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    load: configLoaders,
    validate: validateEnv,
    // `.env` is loaded by `config/load-env.ts`, before any entity module.
    ignoreEnvFile: true,
  }),
  EventEmitterModule.forRoot(),
  ClockModule,
  DatabaseModule,
  RedisModule,
];

@Module({
  imports: [
    ...coreImports,
    ApiV1Module,
    RouterModule.register([{ path: 'api/v1', module: ApiV1Module }]),
  ],
  controllers: [RootController],
})
export class AppModule {}
