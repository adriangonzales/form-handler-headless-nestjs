import type { DataSourceOptions } from 'typeorm';
import { LaravelNamingStrategy } from '../common/db/laravel-naming.strategy';
import type { DatabaseConfig } from '../config';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * Connection options shared by the app and the TypeORM CLI. Migrations run
 * as a release step (`npm run migration:run`), never on boot.
 */
export function dataSourceOptions(config: DatabaseConfig): DataSourceOptions {
  const common = {
    entities: ENTITIES,
    migrations: MIGRATIONS,
    namingStrategy: new LaravelNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
  };

  return config.type === 'postgres'
    ? { ...common, type: 'postgres', url: config.url }
    : { ...common, type: 'better-sqlite3', database: config.url };
}
