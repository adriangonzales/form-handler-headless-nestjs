import { appConfig, readAppConfig } from './app.config';
import { databaseConfig, readDatabaseConfig } from './database.config';
import { Env, EnvReader, EnvValidationError } from './env';
import { httpConfig, readHttpConfig } from './http.config';
import { jwtConfig, readJwtConfig } from './jwt.config';
import { mailConfig, readMailConfig } from './mail.config';
import { queueConfig, readQueueConfig } from './queue.config';
import { readRedisConfig, redisConfig } from './redis.config';
import { readServicesConfig, servicesConfig } from './services.config';
import { readStorageConfig, storageConfig } from './storage.config';

export * from './app.config';
export * from './database.config';
export * from './http.config';
export * from './jwt.config';
export * from './mail.config';
export * from './queue.config';
export * from './redis.config';
export * from './services.config';
export * from './storage.config';

export const configLoaders = [
  appConfig,
  httpConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  queueConfig,
  storageConfig,
  mailConfig,
  servicesConfig,
];

/**
 * `ConfigModule` validation hook: runs every concern's reader against the
 * environment and fails the boot with the full list of problems.
 */
export function validateEnv(env: Env): Env {
  const reader = new EnvReader(env);
  for (const read of [
    readAppConfig,
    readHttpConfig,
    readDatabaseConfig,
    readRedisConfig,
    readJwtConfig,
    readQueueConfig,
    readStorageConfig,
    readMailConfig,
    readServicesConfig,
  ]) {
    read(reader);
  }
  if (reader.errors.length > 0) throw new EnvValidationError(reader.errors);
  return env;
}
