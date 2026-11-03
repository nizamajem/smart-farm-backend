import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhDosing1793750400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "devices" ADD COLUMN "lastPhDose" text');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "devices" DROP COLUMN "lastPhDose"');
  }
}
