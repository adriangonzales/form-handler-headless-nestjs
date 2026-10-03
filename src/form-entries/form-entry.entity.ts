import { Column, Entity, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import {
  jsonColumnType,
  timestampColumn,
  ulidColumnType,
} from '../common/db/column-types';
import { spamScoreTransformer } from '../common/db/spam-score.transformer';
import { SoftDeletableUlidEntity } from '../common/db/ulid-entity';
import type { Form } from '../forms/form.entity';

export interface UserAgentDisplay {
  platform: string | null;
  browser: string | null;
  browser_version: string | null;
}

@Entity('form_entries')
export class FormEntry extends SoftDeletableUlidEntity {
  /**
   * Loading this relation must exclude a soft-deleted form: the ownership
   * check relies on it being missing (ch. 3 §3.3).
   */
  @ManyToOne('Form', (form: Form) => form.entries, { nullable: false })
  @JoinColumn({ name: 'form_id' })
  form!: Relation<Form>;

  @Column({ type: ulidColumnType(), length: 26 })
  formId!: string;

  /** Validated submission values. */
  @Column({ type: jsonColumnType(), nullable: true })
  input!: Record<string, unknown> | unknown[] | null;

  /** Every client IP, comma-joined, in Symfony's order. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  ip!: string | null;

  /** Never populated. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  ipLocationDisplay!: string | null;

  /** Truncated to 255 characters. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  referer!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  /**
   * Laravel declares a `varchar(255)` and casts it to an array. This is
   * `text` on Postgres (`simple-json`): a JSON-string transformer on a
   * varchar would make TypeORM see every save as a change.
   */
  @Column({ type: 'simple-json', nullable: true })
  userAgentDisplay!: UserAgentDisplay | null;

  /** `null` = the spam check hasn't decided. */
  @Column({ type: 'boolean', nullable: true })
  spam: boolean | null = false;

  /** `numeric(3,2)`, rounded to 2 decimals on write, read as a number. */
  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
    transformer: spamScoreTransformer,
  })
  spamScore: number = 0;

  @Column({ type: 'varchar', length: 255, nullable: true })
  spamReason!: string | null;

  /** When the spam check finished (ch. 6). */
  @Column(timestampColumn({ nullable: true }))
  spamCheckedAt!: Date | null;

  @Column({ type: 'boolean', default: false })
  starred: boolean = false;

  /** `null` = unread. */
  @Column(timestampColumn({ nullable: true }))
  readAt!: Date | null;
}
