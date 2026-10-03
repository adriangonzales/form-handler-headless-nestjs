import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateFormNotificationsTable1791000000006 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'form_notifications',
        columns: [
          t.ulid('id', { isPrimary: true }),
          t.ulid('form_id'),
          t.string('type'),
          t.string('value'),
          t.boolean('enabled', { default: true }),
          t.string('error', { isNullable: true }),
          ...t.timestamps(),
          t.softDeletes(),
        ],
        // Laravel's enum('type', ['email', 'sms']).
        checks: [{ expression: `"type" IN ('email', 'sms')` }],
        foreignKeys: [t.foreign('form_id', 'forms')],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('form_notifications');
  }
}
