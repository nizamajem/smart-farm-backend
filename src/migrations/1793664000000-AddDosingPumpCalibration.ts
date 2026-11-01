import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddDosingPumpCalibration1793664000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> { await r.query('ALTER TABLE "devices" ADD COLUMN "dosingPumps" text'); }
  async down(r: QueryRunner): Promise<void> { await r.query('ALTER TABLE "devices" DROP COLUMN "dosingPumps"'); }
}
