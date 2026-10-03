import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { jsonColumnType, timestampColumn } from '../common/db/column-types';

/**
 * The JWT deny list (ch. 5 §5.5). A table rather than a cache, so clearing a
 * cache can't revive logged-out tokens. No `updated_at`.
 */
@Entity('denied_tokens')
export class DeniedToken {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  jti!: string;

  /** Opaque; tymon stores `{"valid_until": <unix>}`. */
  @Column({ type: jsonColumnType() })
  value!: unknown;

  /** Pruned after this. `null` keeps the row forever. */
  @Index()
  @Column(timestampColumn({ nullable: true }))
  expiresAt!: Date | null;

  @Column(timestampColumn({ nullable: true }))
  createdAt!: Date | null;
}
