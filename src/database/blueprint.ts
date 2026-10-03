import type {
  QueryRunner,
  TableColumnOptions,
  TableForeignKeyOptions,
} from 'typeorm';
import { DbType, ulidColumnType } from '../common/db/column-types';

/**
 * Column builders for migrations, named after Laravel's `Blueprint` methods.
 * They pick driver-specific types from the migration's own connection, so the
 * same migrations run on SQLite and Postgres. The drift check (ch. 2 §2.4)
 * proves they match the entities.
 */
export class Blueprint {
  private readonly db: DbType;

  constructor(queryRunner: QueryRunner) {
    this.db =
      queryRunner.connection.options.type === 'postgres'
        ? 'postgres'
        : 'sqlite';
  }

  /** Auto-incrementing integer primary key. */
  increments(name = 'id'): TableColumnOptions {
    return {
      name,
      type: 'integer',
      isPrimary: true,
      isGenerated: true,
      generationStrategy: 'increment',
    };
  }

  ulid(
    name = 'id',
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: ulidColumnType(this.db), length: '26', ...options };
  }

  string(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: 'varchar', length: '255', ...options };
  }

  text(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: 'text', ...options };
  }

  integer(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: 'integer', ...options };
  }

  boolean(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: 'boolean', ...options };
  }

  decimal(
    name: string,
    precision: number,
    scale: number,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: 'decimal', precision, scale, ...options };
  }

  /** `json` on Postgres. SQLite stores `simple-json` entity columns as `text`. */
  json(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return { name, type: this.db === 'postgres' ? 'json' : 'text', ...options };
  }

  /** `timestamp(0)` on Postgres: whole seconds, as Eloquent stores them. */
  timestamp(
    name: string,
    options: Partial<TableColumnOptions> = {},
  ): TableColumnOptions {
    return this.db === 'postgres'
      ? { name, type: 'timestamp', precision: 0, ...options }
      : { name, type: 'datetime', ...options };
  }

  /** Nullable `created_at` and `updated_at`, as Laravel's `timestamps()`. */
  timestamps(): TableColumnOptions[] {
    return [
      this.timestamp('created_at', { isNullable: true }),
      this.timestamp('updated_at', { isNullable: true }),
    ];
  }

  softDeletes(): TableColumnOptions {
    return this.timestamp('deleted_at', { isNullable: true });
  }

  /**
   * Laravel's `foreignId()->constrained()`. The drift check runs on Postgres
   * only: TypeORM's SQLite schema diff reports rebuilds for these tables even
   * when they match.
   */
  foreign(
    column: string,
    table: string,
    onDelete: 'NO ACTION' | 'CASCADE' = 'NO ACTION',
  ): TableForeignKeyOptions {
    return {
      columnNames: [column],
      referencedTableName: table,
      referencedColumnNames: ['id'],
      onDelete,
      onUpdate: 'NO ACTION',
    };
  }
}
