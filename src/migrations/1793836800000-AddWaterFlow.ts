import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWaterFlow1793836800000 implements MigrationInterface {
  async up(r: QueryRunner) { await r.query('ALTER TABLE "sensor_readings" ADD COLUMN "flowIn" real'); await r.query('ALTER TABLE "sensor_readings" ADD COLUMN "flowOut" real'); }
  async down(r: QueryRunner) { await r.query('ALTER TABLE "sensor_readings" DROP COLUMN "flowOut"'); await r.query('ALTER TABLE "sensor_readings" DROP COLUMN "flowIn"'); }
}
