import './config/load-env';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type Redis from 'ioredis';
import { REDIS } from './common/redis/redis.module';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const redis = app.get<Redis>(REDIS);
  await redis.ping();
  Logger.log('Worker started and connected to Redis', 'Worker');
}

void bootstrap();
