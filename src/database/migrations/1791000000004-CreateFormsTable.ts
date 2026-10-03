import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateFormsTable1791000000004 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'forms',
        columns: [
          t.ulid('id', { isPrimary: true }),
          t.integer('user_id'),
          t.string('name', { length: '400' }),
          t.boolean('active', { default: false }),
          t.json('schema', { isNullable: true }),
          t.json('settings', { isNullable: true }),
          ...t.timestamps(),
          t.softDeletes(),
        ],
        foreignKeys: [t.foreign('user_id', 'users')],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('forms');
  }
}
