import { registerAs } from '@nestjs/config';
import { EnvReader, readOrThrow } from './env';

export const DB_TYPES = ['sqlite', 'postgres'] as const;

export interface DatabaseConfig {
  type: (typeof DB_TYPES)[number];
  /** A file path or `:memory:` for SQLite; a connection URL for Postgres. */
  url: string;
}

export function readDatabaseConfig(r: EnvReader): DatabaseConfig {
  const type = r.oneOf('DB_TYPE', DB_TYPES);
  const url = r.required('DB_URL');
  if (type === 'postgres' && url !== '' && !/^postgres(ql)?:\/\//.test(url)) {
    r.fail('DB_URL must be a postgres:// URL when DB_TYPE=postgres');
  }
  return { type, url };
}

export const databaseConfig = registerAs('database', () =>
  readOrThrow(process.env, readDatabaseConfig),
);
