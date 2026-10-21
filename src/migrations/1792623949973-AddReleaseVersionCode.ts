import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReleaseVersionCode1792623949973 implements MigrationInterface {
    name = 'AddReleaseVersionCode1792623949973'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "temporary_app_releases" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "version" varchar NOT NULL, "notes" varchar NOT NULL DEFAULT (''), "fileName" varchar NOT NULL, "size" integer NOT NULL, "sha256" varchar NOT NULL, "downloads" integer NOT NULL DEFAULT (0), "uploadedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "versionCode" integer, CONSTRAINT "FK_14d4810d02c5b7536aca04f970c" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_app_releases"("id", "version", "notes", "fileName", "size", "sha256", "downloads", "uploadedById", "createdAt") SELECT "id", "version", "notes", "fileName", "size", "sha256", "downloads", "uploadedById", "createdAt" FROM "app_releases"`);
        await queryRunner.query(`DROP TABLE "app_releases"`);
        await queryRunner.query(`ALTER TABLE "temporary_app_releases" RENAME TO "app_releases"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "app_releases" RENAME TO "temporary_app_releases"`);
        await queryRunner.query(`CREATE TABLE "app_releases" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "version" varchar NOT NULL, "notes" varchar NOT NULL DEFAULT (''), "fileName" varchar NOT NULL, "size" integer NOT NULL, "sha256" varchar NOT NULL, "downloads" integer NOT NULL DEFAULT (0), "uploadedById" integer, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_14d4810d02c5b7536aca04f970c" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "app_releases"("id", "version", "notes", "fileName", "size", "sha256", "downloads", "uploadedById", "createdAt") SELECT "id", "version", "notes", "fileName", "size", "sha256", "downloads", "uploadedById", "createdAt" FROM "temporary_app_releases"`);
        await queryRunner.query(`DROP TABLE "temporary_app_releases"`);
    }

}
