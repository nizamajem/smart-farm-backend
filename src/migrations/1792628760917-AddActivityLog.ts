import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActivityLog1792628760917 implements MigrationInterface {
    name = 'AddActivityLog1792628760917'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "activity_logs" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "type" varchar NOT NULL, "action" varchar, "description" varchar NOT NULL, "deviceId" integer, "platform" varchar, "appVersion" varchar, "ip" varchar, "userAgent" varchar, "meta" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_412f03f2a073c89f8918e6ae52" ON "activity_logs" ("userId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "temporary_users" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "email" varchar NOT NULL, "passwordHash" varchar NOT NULL, "role" varchar NOT NULL DEFAULT ('user'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "lastLoginAt" datetime, "lastSeenAt" datetime, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"))`);
        await queryRunner.query(`INSERT INTO "temporary_users"("id", "name", "email", "passwordHash", "role", "createdAt") SELECT "id", "name", "email", "passwordHash", "role", "createdAt" FROM "users"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`ALTER TABLE "temporary_users" RENAME TO "users"`);
        await queryRunner.query(`DROP INDEX "IDX_412f03f2a073c89f8918e6ae52"`);
        await queryRunner.query(`CREATE TABLE "temporary_activity_logs" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "type" varchar NOT NULL, "action" varchar, "description" varchar NOT NULL, "deviceId" integer, "platform" varchar, "appVersion" varchar, "ip" varchar, "userAgent" varchar, "meta" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_597e6df96098895bf19d4b5ea45" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_activity_logs"("id", "userId", "type", "action", "description", "deviceId", "platform", "appVersion", "ip", "userAgent", "meta", "createdAt") SELECT "id", "userId", "type", "action", "description", "deviceId", "platform", "appVersion", "ip", "userAgent", "meta", "createdAt" FROM "activity_logs"`);
        await queryRunner.query(`DROP TABLE "activity_logs"`);
        await queryRunner.query(`ALTER TABLE "temporary_activity_logs" RENAME TO "activity_logs"`);
        await queryRunner.query(`CREATE INDEX "IDX_412f03f2a073c89f8918e6ae52" ON "activity_logs" ("userId", "createdAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_412f03f2a073c89f8918e6ae52"`);
        await queryRunner.query(`ALTER TABLE "activity_logs" RENAME TO "temporary_activity_logs"`);
        await queryRunner.query(`CREATE TABLE "activity_logs" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "type" varchar NOT NULL, "action" varchar, "description" varchar NOT NULL, "deviceId" integer, "platform" varchar, "appVersion" varchar, "ip" varchar, "userAgent" varchar, "meta" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`INSERT INTO "activity_logs"("id", "userId", "type", "action", "description", "deviceId", "platform", "appVersion", "ip", "userAgent", "meta", "createdAt") SELECT "id", "userId", "type", "action", "description", "deviceId", "platform", "appVersion", "ip", "userAgent", "meta", "createdAt" FROM "temporary_activity_logs"`);
        await queryRunner.query(`DROP TABLE "temporary_activity_logs"`);
        await queryRunner.query(`CREATE INDEX "IDX_412f03f2a073c89f8918e6ae52" ON "activity_logs" ("userId", "createdAt") `);
        await queryRunner.query(`ALTER TABLE "users" RENAME TO "temporary_users"`);
        await queryRunner.query(`CREATE TABLE "users" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "email" varchar NOT NULL, "passwordHash" varchar NOT NULL, "role" varchar NOT NULL DEFAULT ('user'), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"))`);
        await queryRunner.query(`INSERT INTO "users"("id", "name", "email", "passwordHash", "role", "createdAt") SELECT "id", "name", "email", "passwordHash", "role", "createdAt" FROM "temporary_users"`);
        await queryRunner.query(`DROP TABLE "temporary_users"`);
        await queryRunner.query(`DROP INDEX "IDX_412f03f2a073c89f8918e6ae52"`);
        await queryRunner.query(`DROP TABLE "activity_logs"`);
    }

}
