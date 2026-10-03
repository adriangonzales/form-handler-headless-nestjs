import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export interface RedisConfig {
  url: string;
}

export function readRedisConfig(r: EnvReader): RedisConfig {
  const url = r.required('REDIS_URL');
  if (url !== '' && !/^rediss?:\/\//.test(url)) {
    r.fail('REDIS_URL must be a redis:// or rediss:// URL');
  }
  return { url };
}

export const redisConfig = registerAs('redis', () =>
  readOrThrow(process.env, readRedisConfig),
);
