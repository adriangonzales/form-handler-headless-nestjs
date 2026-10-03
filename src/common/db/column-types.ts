import type { ColumnOptions } from 'typeorm';

/**
 * Driver-specific column types. Decorator arguments are evaluated when the
 * entity class loads, so these read `DB_TYPE` from `process.env` at import
 * time (ch. 2 §2.3). Migrations pass their own driver type instead.
 */
export type DbType = 'postgres' | 'sqlite';

export function currentDbType(): DbType {
  return process.env.DB_TYPE === 'postgres' ? 'postgres' : 'sqlite';
}

/**
 * `json` on Postgres, not `jsonb`: `jsonb` reorders object keys and drops
 * duplicates. SQLite has no JSON binding, so it stores text via `simple-json`.
 */
export function jsonColumnType(db: DbType = currentDbType()) {
  return db === 'postgres' ? ('json' as const) : ('simple-json' as const);
}

/** `char(26)` for ULIDs. TypeORM's SQLite driver spells it `character`. */
export function ulidColumnType(db: DbType = currentDbType()) {
  return db === 'postgres' ? ('char' as const) : ('character' as const);
}

/**
 * `timestamp(0)` on Postgres, `datetime` on SQLite. `TimestampSubscriber`
 * truncates values to whole seconds on save. (Not a transformer: TypeORM
 * then compares a `Date` with a string and sees every save as a change.)
 */
export function timestampColumn(
  options: Omit<ColumnOptions, 'type' | 'precision'> = {},
  db: DbType = currentDbType(),
): ColumnOptions {
  return db === 'postgres'
    ? { ...options, type: 'timestamp', precision: 0 }
    : { ...options, type: 'datetime' };
}
