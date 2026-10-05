import { Injectable } from '@nestjs/common';
import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  type ObjectLiteral,
} from 'typeorm';
import { Storage } from '../common/storage/storage';
import { FormEntryExport } from '../entry-exports/form-entry-export.entity';
import { FormEntry } from '../form-entries/form-entry.entity';
import { FormNotification } from '../form-notifications/form-notification.entity';
import { Form } from '../forms/form.entity';
import { User } from '../users/user.entity';
import { PasswordResetToken } from './password-reset-token.entity';

/** `Form::withTrashed()->where('user_id', $id)->select('id')`, as a subquery. */
const USER_FORM_IDS =
  'form_id IN (SELECT id FROM forms WHERE user_id = :userId)';

/**
 * `DeleteAccount` (ch. 5 §5.7): permanently deletes the user and everything
 * they own, including soft-deleted forms, entries and notifications, in one
 * transaction; export files are removed after it commits.
 */
@Injectable()
export class DeleteAccount {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: Storage,
  ) {}

  async execute(user: User): Promise<void> {
    const userId = user.id;
    const exportFiles = await this.dataSource
      .getRepository(FormEntryExport)
      .createQueryBuilder()
      .select(['disk', 'path'])
      .where(USER_FORM_IDS, { userId })
      .andWhere('path IS NOT NULL')
      .getRawMany<{ disk: string; path: string }>();

    await this.dataSource.transaction(async (manager) => {
      const deleteOwned = (target: EntityTarget<ObjectLiteral>) =>
        deleteWhere(manager, target, USER_FORM_IDS, { userId });
      await deleteOwned(FormEntryExport);
      await deleteOwned(FormEntry);
      await deleteOwned(FormNotification);
      await deleteWhere(manager, Form, 'user_id = :userId', { userId });
      await manager.delete(PasswordResetToken, { email: user.email });
      await manager.delete(User, { id: userId });
    });

    for (const file of exportFiles) {
      await this.storage.disk(file.disk).delete(file.path);
    }
  }
}

function deleteWhere(
  manager: EntityManager,
  target: EntityTarget<ObjectLiteral>,
  where: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return manager
    .createQueryBuilder()
    .delete()
    .from(target)
    .where(where, params)
    .execute();
}
