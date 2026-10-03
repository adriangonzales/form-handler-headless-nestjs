import { CreateUsersTable1791000000001 } from './1791000000001-CreateUsersTable';
import { CreatePasswordResetTokensTable1791000000002 } from './1791000000002-CreatePasswordResetTokensTable';
import { CreateDeniedTokensTable1791000000003 } from './1791000000003-CreateDeniedTokensTable';
import { CreateFormsTable1791000000004 } from './1791000000004-CreateFormsTable';
import { CreateFormEntriesTable1791000000005 } from './1791000000005-CreateFormEntriesTable';
import { CreateFormNotificationsTable1791000000006 } from './1791000000006-CreateFormNotificationsTable';
import { CreateFormEntryExportsTable1791000000007 } from './1791000000007-CreateFormEntryExportsTable';

/**
 * Every migration, in order. Listed explicitly (not globbed) so they load
 * under ts-jest for the Postgres e2e run. Add new migrations here.
 */
export const MIGRATIONS = [
  CreateUsersTable1791000000001,
  CreatePasswordResetTokensTable1791000000002,
  CreateDeniedTokensTable1791000000003,
  CreateFormsTable1791000000004,
  CreateFormEntriesTable1791000000005,
  CreateFormNotificationsTable1791000000006,
  CreateFormEntryExportsTable1791000000007,
];
