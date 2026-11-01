import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartMcb1793491200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "devices" ADD COLUMN "haMcbEntity" varchar');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "devices" DROP COLUMN "haMcbEntity"');
  }
}
