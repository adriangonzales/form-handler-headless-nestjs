import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  type Relation,
} from 'typeorm';
import { jsonColumnType } from '../common/db/column-types';
import { SoftDeletableUlidEntity } from '../common/db/ulid-entity';
import type { FormEntryExport } from '../entry-exports/form-entry-export.entity';
import type { FormEntry } from '../form-entries/form-entry.entity';
import type { FormNotification } from '../form-notifications/form-notification.entity';
import type { User } from '../users/user.entity';
import { FormField, orderedSchema } from './form-field';
import type { FormSettings } from './form-settings';

@Entity('forms')
export class Form extends SoftDeletableUlidEntity {
  /** No cascade: account deletion cleans up (ch. 5). */
  @ManyToOne('User', (user: User) => user.forms, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<User>;

  @Column({ type: 'integer' })
  userId!: number;

  @Column({ type: 'varchar', length: 400 })
  name!: string;

  @Column({ type: 'boolean', default: false })
  active: boolean = false;

  @Column({ type: jsonColumnType(), nullable: true })
  schema!: FormField[] | null;

  /** Read through `withSettingsDefaults()`. */
  @Column({ type: jsonColumnType(), nullable: true })
  settings!: Partial<FormSettings> | null;

  @OneToMany('FormEntry', (entry: FormEntry) => entry.form)
  entries!: Relation<FormEntry[]>;

  @OneToMany(
    'FormNotification',
    (notification: FormNotification) => notification.form,
  )
  notifications!: Relation<FormNotification[]>;

  @OneToMany(
    'FormEntryExport',
    (entryExport: FormEntryExport) => entryExport.form,
  )
  entryExports!: Relation<FormEntryExport[]>;

  /** Fields sorted by `order`; ties keep their stored order. */
  orderedSchema(): FormField[] {
    return orderedSchema(this.schema);
  }
}
