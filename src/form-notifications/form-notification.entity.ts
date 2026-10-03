import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import { ulidColumnType } from '../common/db/column-types';
import { SoftDeletableUlidEntity } from '../common/db/ulid-entity';
import type { Form } from '../forms/form.entity';
import { NotificationType } from './notification-type';

/** Laravel's `enum()` column: a `varchar` with a check constraint. */
@Entity('form_notifications')
@Check(`"type" IN ('email', 'sms')`)
export class FormNotification extends SoftDeletableUlidEntity {
  @ManyToOne('Form', (form: Form) => form.notifications, { nullable: false })
  @JoinColumn({ name: 'form_id' })
  form!: Relation<Form>;

  @Column({ type: ulidColumnType(), length: 26 })
  formId!: string;

  @Column({ type: 'varchar', length: 255 })
  type!: NotificationType;

  /** Email address or E.164 number. */
  @Column({ type: 'varchar', length: 255 })
  value!: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean = true;

  /** Last delivery failure or bounce (ch. 6). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  error!: string | null;
}
