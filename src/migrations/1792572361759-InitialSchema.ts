import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1792572361759 implements MigrationInterface {
    name = 'InitialSchema1792572361759'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "email" varchar NOT NULL, "passwordHash" varchar NOT NULL, "role" varchar NOT NULL DEFAULT ('user'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"))`);
        await queryRunner.query(`CREATE TABLE "devices" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "location" varchar NOT NULL DEFAULT (''), "apiKey" varchar NOT NULL, "relayLabels" text NOT NULL, "ownerId" integer NOT NULL, "lastSeenAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_07fe1a62a15cf14e3fd877626b7" UNIQUE ("apiKey"))`);
        await queryRunner.query(`CREATE TABLE "sensor_readings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "temperature" real, "humidity" real, "soilMoisture" real, "lightLux" real, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_114b49a5a43e1c70244c95085a" ON "sensor_readings" ("deviceId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "relay_commands" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "relay" integer NOT NULL, "action" varchar NOT NULL, "durationMs" integer NOT NULL DEFAULT (0), "status" varchar NOT NULL DEFAULT ('pending'), "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "ackAt" datetime)`);
        await queryRunner.query(`CREATE TABLE "temporary_devices" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "location" varchar NOT NULL DEFAULT (''), "apiKey" varchar NOT NULL, "relayLabels" text NOT NULL, "ownerId" integer NOT NULL, "lastSeenAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_07fe1a62a15cf14e3fd877626b7" UNIQUE ("apiKey"), CONSTRAINT "FK_968904d168816becbe1012dabcf" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_devices"("id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt") SELECT "id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt" FROM "devices"`);
        await queryRunner.query(`DROP TABLE "devices"`);
        await queryRunner.query(`ALTER TABLE "temporary_devices" RENAME TO "devices"`);
        await queryRunner.query(`DROP INDEX "IDX_114b49a5a43e1c70244c95085a"`);
        await queryRunner.query(`CREATE TABLE "temporary_sensor_readings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "temperature" real, "humidity" real, "soilMoisture" real, "lightLux" real, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_ae954847a60a3a5c28a29f7cc99" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_sensor_readings"("id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt") SELECT "id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt" FROM "sensor_readings"`);
        await queryRunner.query(`DROP TABLE "sensor_readings"`);
        await queryRunner.query(`ALTER TABLE "temporary_sensor_readings" RENAME TO "sensor_readings"`);
        await queryRunner.query(`CREATE INDEX "IDX_114b49a5a43e1c70244c95085a" ON "sensor_readings" ("deviceId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "temporary_relay_commands" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "relay" integer NOT NULL, "action" varchar NOT NULL, "durationMs" integer NOT NULL DEFAULT (0), "status" varchar NOT NULL DEFAULT ('pending'), "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "ackAt" datetime, CONSTRAINT "FK_ea41b0f6f071abdd51beff42ed6" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_01f3bab6d16f678e3881dc57ad2" FOREIGN KEY ("requestedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_relay_commands"("id", "deviceId", "relay", "action", "durationMs", "status", "requestedById", "createdAt", "ackAt") SELECT "id", "deviceId", "relay", "action", "durationMs", "status", "requestedById", "createdAt", "ackAt" FROM "relay_commands"`);
        await queryRunner.query(`DROP TABLE "relay_commands"`);
        await queryRunner.query(`ALTER TABLE "temporary_relay_commands" RENAME TO "relay_commands"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "relay_commands" RENAME TO "temporary_relay_commands"`);
        await queryRunner.query(`CREATE TABLE "relay_commands" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "relay" integer NOT NULL, "action" varchar NOT NULL, "durationMs" integer NOT NULL DEFAULT (0), "status" varchar NOT NULL DEFAULT ('pending'), "requestedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "ackAt" datetime)`);
        await queryRunner.query(`INSERT INTO "relay_commands"("id", "deviceId", "relay", "action", "durationMs", "status", "requestedById", "createdAt", "ackAt") SELECT "id", "deviceId", "relay", "action", "durationMs", "status", "requestedById", "createdAt", "ackAt" FROM "temporary_relay_commands"`);
        await queryRunner.query(`DROP TABLE "temporary_relay_commands"`);
        await queryRunner.query(`DROP INDEX "IDX_114b49a5a43e1c70244c95085a"`);
        await queryRunner.query(`ALTER TABLE "sensor_readings" RENAME TO "temporary_sensor_readings"`);
        await queryRunner.query(`CREATE TABLE "sensor_readings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "temperature" real, "humidity" real, "soilMoisture" real, "lightLux" real, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`INSERT INTO "sensor_readings"("id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt") SELECT "id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt" FROM "temporary_sensor_readings"`);
        await queryRunner.query(`DROP TABLE "temporary_sensor_readings"`);
        await queryRunner.query(`CREATE INDEX "IDX_114b49a5a43e1c70244c95085a" ON "sensor_readings" ("deviceId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "devices" RENAME TO "temporary_devices"`);
        await queryRunner.query(`CREATE TABLE "devices" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "location" varchar NOT NULL DEFAULT (''), "apiKey" varchar NOT NULL, "relayLabels" text NOT NULL, "ownerId" integer NOT NULL, "lastSeenAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_07fe1a62a15cf14e3fd877626b7" UNIQUE ("apiKey"))`);
        await queryRunner.query(`INSERT INTO "devices"("id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt") SELECT "id", "name", "location", "apiKey", "relayLabels", "ownerId", "lastSeenAt", "createdAt" FROM "temporary_devices"`);
        await queryRunner.query(`DROP TABLE "temporary_devices"`);
        await queryRunner.query(`DROP TABLE "relay_commands"`);
        await queryRunner.query(`DROP INDEX "IDX_114b49a5a43e1c70244c95085a"`);
        await queryRunner.query(`DROP TABLE "sensor_readings"`);
        await queryRunner.query(`DROP TABLE "devices"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
