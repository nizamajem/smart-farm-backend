import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMandatoryRelease1794902400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "app_releases" ADD "mandatory" boolean NOT NULL DEFAULT (0)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "app_releases" DROP COLUMN "mandatory"`);
  }
}
