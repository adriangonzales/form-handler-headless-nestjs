import { BeforeInsert, Column, DeleteDateColumn, PrimaryColumn } from 'typeorm';
import { timestampColumn, ulidColumnType } from './column-types';
import { newUlid } from './ulid';

/**
 * ULID primary key plus `created_at` / `updated_at` (ch. 2 §2.1). The
 * timestamps come from the `Clock` through `TimestampSubscriber`, never from
 * database defaults.
 *
 * `@BeforeInsert` only runs for `save()` on an entity instance, so
 * `insert()` callers (and factories) must set `id` themselves.
 */
export abstract class UlidEntity {
  @PrimaryColumn({ type: ulidColumnType(), length: 26 })
  id!: string;

  // Nullable like Laravel's `timestamps()`, but always set on save.
  @Column(timestampColumn({ name: 'created_at', nullable: true }))
  createdAt!: Date;

  @Column(timestampColumn({ name: 'updated_at', nullable: true }))
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newUlid();
  }
}

/**
 * Adds `deleted_at`. `find*` hides trashed rows, as Laravel's `SoftDeletes`
 * does; pass `withDeleted: true` only where Laravel uses `withTrashed()`.
 * Soft-delete with `update(..., { deletedAt: clock.now() })`, not
 * `softDelete()`, which takes the database's time.
 */
export abstract class SoftDeletableUlidEntity extends UlidEntity {
  @DeleteDateColumn(timestampColumn({ name: 'deleted_at', nullable: true }))
  deletedAt!: Date | null;
}
