import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import {
  jsonColumnType,
  timestampColumn,
  ulidColumnType,
} from '../common/db/column-types';
import { UlidEntity } from '../common/db/ulid-entity';
import type { Form } from '../forms/form.entity';
import { ExportStatus } from './export-status';

/** No soft delete; deleted with its form. */
@Entity('form_entry_exports')
export class FormEntryExport extends UlidEntity {
  @ManyToOne('Form', (form: Form) => form.entryExports, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'form_id' })
  form!: Relation<Form>;

  @Column({ type: ulidColumnType(), length: 26 })
  formId!: string;

  @Column({ type: 'varchar', length: 255, default: ExportStatus.Pending })
  status: ExportStatus = ExportStatus.Pending;

  /** Validated `{sort?, filter?}` from the request. */
  @Column({ type: jsonColumnType() })
  parameters!: Record<string, unknown>;

  /** Storage disk the file was written to. */
  @Column({ type: 'varchar', length: 255 })
  disk!: string;

  /** `entry-exports/{id}.csv` once written. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  path!: string | null;

  /** Download name (ch. 3 §3.7). */
  @Column({ type: 'varchar', length: 255 })
  filename!: string;

  @Column({ type: 'integer', nullable: true })
  rowCount!: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error!: string | null;

  @Column(timestampColumn({ nullable: true }))
  completedAt!: Date | null;

  /** Creation + 24 hours. */
  @Index()
  @Column(timestampColumn())
  expiresAt!: Date;
}
