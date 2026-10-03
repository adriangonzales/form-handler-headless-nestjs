import { existsSync } from 'node:fs';

/**
 * Loads `.env` into `process.env`; variables already set win. Every
 * entrypoint imports this **first**: entity decorators read `DB_TYPE` when
 * their modules load (ch. 2 §2.3), which is before `ConfigModule` runs.
 * Tests set their environment in `test/setup-env.ts` instead.
 */
if (process.env.NODE_ENV !== 'test' && existsSync('.env')) {
  process.loadEnvFile('.env');
}
