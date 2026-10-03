import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import type { DatabaseConfig } from '../config';

/**
 * Connection options shared by the app and the TypeORM CLI. Migrations run
 * as a release step (`npm run migration:run`), never on boot.
 */
export function dataSourceOptions(config: DatabaseConfig): DataSourceOptions {
  const common = {
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
  };

  return config.type === 'postgres'
    ? { ...common, type: 'postgres', url: config.url }
    : { ...common, type: 'better-sqlite3', database: config.url };
}
