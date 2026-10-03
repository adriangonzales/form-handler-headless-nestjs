import { Column, Entity, PrimaryColumn } from 'typeorm';
import { timestampColumn } from '../common/db/column-types';

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  email!: string;

  /** bcrypt hash of the emailed token. */
  @Column({ type: 'varchar', length: 255 })
  token!: string;

  /** Drives the 60-minute expiry and the 60-second throttle. */
  @Column(timestampColumn({ nullable: true }))
  createdAt!: Date | null;
}
