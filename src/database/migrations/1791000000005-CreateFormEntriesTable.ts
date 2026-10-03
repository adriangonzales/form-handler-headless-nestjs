import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateFormEntriesTable1791000000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'form_entries',
        columns: [
          t.ulid('id', { isPrimary: true }),
          t.ulid('form_id'),
          t.json('input', { isNullable: true }),
          t.string('ip', { isNullable: true }),
          t.string('ip_location_display', { isNullable: true }),
          t.string('referer', { isNullable: true }),
          t.string('user_agent', { isNullable: true }),
          t.text('user_agent_display', { isNullable: true }),
          t.boolean('spam', { isNullable: true }),
          t.decimal('spam_score', 3, 2, { default: 0 }),
          t.string('spam_reason', { isNullable: true }),
          t.timestamp('spam_checked_at', { isNullable: true }),
          t.boolean('starred', { default: false }),
          t.timestamp('read_at', { isNullable: true }),
          ...t.timestamps(),
          t.softDeletes(),
        ],
        foreignKeys: [t.foreign('form_id', 'forms')],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('form_entries');
  }
}
