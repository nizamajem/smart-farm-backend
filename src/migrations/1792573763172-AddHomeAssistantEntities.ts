import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHomeAssistantEntities1792573763172 implements MigrationInterface {
    name = 'AddHomeAssistantEntities1792573763172'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_devices" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "location" varchar NOT NULL DEFAULT (''), "apiKey" varchar NOT NULL, "relayLabels" text NOT NULL, "ownerId" integer NOT NULL, "lastSeenAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "haEntities" text, CONSTRAINT "UQ_07fe1a62a15cf14e3fd877626b7" UNIQUE ("apiKey"), CONSTRAINT "FK_968904d168816becbe1012dabcf" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_devices"("id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt") SELECT "id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt" FROM "devices"`);
        await queryRunner.query(`DROP TABLE "devices"`);
        await queryRunner.query(`ALTER TABLE "temporary_devices" RENAME TO "devices"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "devices" RENAME TO "temporary_devices"`);
        await queryRunner.query(`CREATE TABLE "devices" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "location" varchar NOT NULL DEFAULT (''), "apiKey" varchar NOT NULL, "relayLabels" text NOT NULL, "ownerId" integer NOT NULL, "lastSeenAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_07fe1a62a15cf14e3fd877626b7" UNIQUE ("apiKey"), CONSTRAINT "FK_968904d168816becbe1012dabcf" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "devices"("id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt") SELECT "id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt" FROM "temporary_devices"`);
        await queryRunner.query(`DROP TABLE "temporary_devices"`);
    }

}
