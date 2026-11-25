import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAutomaticNutrients1795651200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "devices" ADD COLUMN "automaticNutrients" text');
    await q.query('ALTER TABLE "devices" ADD COLUMN "automaticState" text');
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "devices" DROP COLUMN "automaticState"');
    await q.query('ALTER TABLE "devices" DROP COLUMN "automaticNutrients"');
  }
}
