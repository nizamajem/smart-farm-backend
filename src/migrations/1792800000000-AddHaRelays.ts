import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHaRelays1792800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Use SQLite ALTER directly: rebuilding the parent table can trigger ON DELETE CASCADE.
    await runner.query('ALTER TABLE "devices" ADD COLUMN "haRelays" text');
    await runner.query('ALTER TABLE "relay_commands" ADD COLUMN "transport" varchar NOT NULL DEFAULT \'device\'');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE "relay_commands" DROP COLUMN "transport"');
    await runner.query('ALTER TABLE "devices" DROP COLUMN "haRelays"');
  }
}
