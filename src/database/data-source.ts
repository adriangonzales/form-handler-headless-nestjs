import '../config/load-env';
import { DataSource } from 'typeorm';
import { readDatabaseConfig } from '../config/database.config';
import { readOrThrow } from '../config/env';
import { dataSourceOptions } from './data-source-options';

// Entry point for the TypeORM CLI (`migration:generate`, `migration:run`).
export default new DataSource(
  dataSourceOptions(readOrThrow(process.env, readDatabaseConfig)),
);
