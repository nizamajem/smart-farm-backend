import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddWaterTemperature1795564800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE "sensor_readings" ADD COLUMN "waterTemperature" real'); }
  async down(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE "sensor_readings" DROP COLUMN "waterTemperature"'); }
}
