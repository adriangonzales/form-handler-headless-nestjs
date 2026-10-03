import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateUsersTable1791000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          t.increments(),
          t.string('name'),
          t.string('email'),
          t.timestamp('email_verified_at', { isNullable: true }),
          t.string('password'),
          t.string('remember_token', { length: '100', isNullable: true }),
          t.integer('token_version', { default: 0 }),
          ...t.timestamps(),
        ],
        uniques: [{ columnNames: ['email'] }],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
