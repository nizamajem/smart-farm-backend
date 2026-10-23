import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

const fields = ['ph', 'orp', 'conductivity', 'tds', 'salinity', 'specificGravity', 'conductivityFactor'];

export class AddWaterQuality1792713600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('sensor_readings', fields.map((name) => new TableColumn({ name, type: 'real', isNullable: true })));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('sensor_readings', fields);
  }
}
