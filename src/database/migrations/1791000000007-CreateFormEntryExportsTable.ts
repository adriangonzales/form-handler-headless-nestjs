import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateFormEntryExportsTable1791000000007 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'form_entry_exports',
        columns: [
          t.ulid('id', { isPrimary: true }),
          t.ulid('form_id'),
          t.string('status', { default: `'pending'` }),
          t.json('parameters'),
          t.string('disk'),
          t.string('path', { isNullable: true }),
          t.string('filename'),
          t.integer('row_count', { isNullable: true }),
          t.string('error', { isNullable: true }),
          t.timestamp('completed_at', { isNullable: true }),
          t.timestamp('expires_at'),
          ...t.timestamps(),
        ],
        indices: [{ columnNames: ['expires_at'] }],
        foreignKeys: [t.foreign('form_id', 'forms', 'CASCADE')],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('form_entry_exports');
  }
}
