import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPanelAccessories1794355200000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query('ALTER TABLE "devices" ADD COLUMN "accessories" text');
  }
  async down(r: QueryRunner) {
    await r.query('ALTER TABLE "devices" DROP COLUMN "accessories"');
  }
}
