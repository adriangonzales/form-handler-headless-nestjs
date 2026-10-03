import { MigrationInterface, QueryRunner, Table } from 'typeorm';
import { Blueprint } from '../blueprint';

export class CreateDeniedTokensTable1791000000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const t = new Blueprint(queryRunner);
    await queryRunner.createTable(
      new Table({
        name: 'denied_tokens',
        columns: [
          t.string('jti', { isPrimary: true }),
          t.json('value'),
          t.timestamp('expires_at', { isNullable: true }),
          t.timestamp('created_at', { isNullable: true }),
        ],
        indices: [{ columnNames: ['expires_at'] }],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('denied_tokens');
  }
}
