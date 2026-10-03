import { PasswordResetToken } from '../accounts/password-reset-token.entity';
import { DeniedToken } from '../auth/denied-token.entity';
import { FormEntryExport } from '../entry-exports/form-entry-export.entity';
import { FormEntry } from '../form-entries/form-entry.entity';
import { FormNotification } from '../form-notifications/form-notification.entity';
import { Form } from '../forms/form.entity';
import { User } from '../users/user.entity';

/** Every entity, listed explicitly: file globs don't load under ts-jest. */
export const ENTITIES = [
  User,
  PasswordResetToken,
  DeniedToken,
  Form,
  FormEntry,
  FormNotification,
  FormEntryExport,
];
