import '../../config/load-env';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { coreImports } from '../../app.module';
import { Clock } from '../../common/clock/clock';
import { Factories } from '../factories/factories';

@Module({ imports: coreImports })
class SeedModule {}

/**
 * `npm run seed`: Laravel's `DatabaseSeeder` (the Test User) plus the
 * `FormSeeder`, `FormEntrySeeder` and `FormNotificationSeeder`. As in
 * Laravel, each factory row gets its own parent rows. Run the migrations
 * first.
 */
async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const factories = new Factories(app.get(DataSource), app.get(Clock));
    await factories.user({ name: 'Test User', email: 'test@example.com' });
    for (let i = 0; i < 5; i++) await factories.form();
    for (let i = 0; i < 5; i++) await factories.entry();
    for (let i = 0; i < 5; i++) await factories.notification();
    Logger.log(
      'Seeded the Test User, 5 forms, 5 entries and 5 notifications',
      'Seed',
    );
  } finally {
    await app.close();
  }
}

seed().catch((error: unknown) => {
  Logger.error(error, 'Seed');
  process.exitCode = 1;
});
