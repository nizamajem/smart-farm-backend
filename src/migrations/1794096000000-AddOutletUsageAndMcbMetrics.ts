import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutletUsageAndMcbMetrics1794096000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    for (const column of ['flowOutTotal', 'mcbPower', 'mcbVoltage', 'mcbCurrent']) {
      await r.query(`ALTER TABLE "sensor_readings" ADD COLUMN "${column}" real`);
    }
  }
  async down(r: QueryRunner) {
    for (const column of ['mcbCurrent', 'mcbVoltage', 'mcbPower', 'flowOutTotal']) {
      await r.query(`ALTER TABLE "sensor_readings" DROP COLUMN "${column}"`);
    }
  }
}
