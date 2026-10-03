import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export const QUEUE_DRIVERS = ['bullmq', 'sync'] as const;

export interface QueueConfig {
  driver: (typeof QUEUE_DRIVERS)[number];
}

export function readQueueConfig(r: EnvReader): QueueConfig {
  return { driver: r.oneOf('QUEUE_DRIVER', QUEUE_DRIVERS, 'bullmq') };
}

export const queueConfig = registerAs('queue', () =>
  readOrThrow(process.env, readQueueConfig),
);
