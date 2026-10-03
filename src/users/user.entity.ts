import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { timestampColumn } from '../common/db/column-types';
import type { Form } from '../forms/form.entity';

/**
 * Users keep integer IDs (ch. 2 §2.2). Never expose `password`,
 * `rememberToken` or `tokenVersion` (Laravel's `$hidden`).
 */
@Entity('users')
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn('increment', { type: 'integer' })
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Stored lowercase. */
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** Cleared when the email changes; otherwise unused. */
  @Column(timestampColumn({ nullable: true }))
  emailVerifiedAt!: Date | null;

  /** bcrypt. */
  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  rememberToken!: string | null;

  /** Bumped to revoke every token (ch. 5 §5.6). */
  @Column({ type: 'integer', default: 0 })
  tokenVersion: number = 0;

  @Column(timestampColumn({ nullable: true }))
  createdAt!: Date;

  @Column(timestampColumn({ nullable: true }))
  updatedAt!: Date;

  @OneToMany('Form', (form: Form) => form.user)
  forms!: Relation<Form[]>;
}
