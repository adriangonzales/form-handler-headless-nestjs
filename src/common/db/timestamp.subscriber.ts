import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  type ObjectLiteral,
} from 'typeorm';
import type { EntityMetadata } from 'typeorm';
import { Clock, wholeSeconds } from '../clock/clock';

/**
 * Eloquent's timestamp handling for `save()` (ch. 2 §2.1):
 * - Every `Date` column is truncated to whole seconds, as Eloquent stores them
 *   (Postgres `timestamp(0)` would round instead).
 * - On insert, `created_at` / `updated_at` come from the `Clock` unless set.
 * - On an update with changes, `updated_at` comes from the `Clock` unless the
 *   caller changed it.
 *
 * Query-builder writes (`update()`, `insert()`) bypass subscribers: callers
 * set `updated_at` / `deleted_at` from the `Clock` themselves.
 */
@Injectable()
export class TimestampSubscriber implements EntitySubscriberInterface {
  constructor(
    private readonly clock: Clock,
    @InjectDataSource() dataSource?: DataSource,
  ) {
    dataSource?.subscribers.push(this);
  }

  beforeInsert(event: InsertEvent<ObjectLiteral>): void {
    const { entity, metadata } = event;
    truncateDates(entity, metadata);
    const now = this.clock.now();
    for (const property of ['createdAt', 'updatedAt']) {
      const column = metadata.findColumnWithPropertyName(property);
      if (column && column.getEntityValue(entity) == null) {
        column.setEntityValue(entity, now);
      }
    }
  }

  beforeUpdate(event: UpdateEvent<ObjectLiteral>): void {
    const { entity, databaseEntity, metadata } = event;
    if (!entity) return;
    truncateDates(entity, metadata);

    const updatedAt = metadata.findColumnWithPropertyName('updatedAt');
    if (!updatedAt) return;

    // TypeORM computed the changes before truncation; ignore columns that
    // only differed below a second.
    const changed = event.updatedColumns.filter(
      (column) =>
        !sameInstant(
          column.getEntityValue(entity),
          databaseEntity && column.getEntityValue(databaseEntity),
        ),
    );
    if (changed.length === 0 && event.updatedRelations.length === 0) return;
    if (changed.includes(updatedAt)) return; // set explicitly by the caller

    updatedAt.setEntityValue(entity, this.clock.now());
  }
}

function truncateDates(entity: ObjectLiteral, metadata: EntityMetadata): void {
  for (const column of metadata.columns) {
    const value: unknown = column.getEntityValue(entity);
    if (value instanceof Date)
      column.setEntityValue(entity, wholeSeconds(value));
  }
}

function sameInstant(a: unknown, b: unknown): boolean {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}
