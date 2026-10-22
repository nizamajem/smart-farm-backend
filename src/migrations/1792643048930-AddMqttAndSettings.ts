import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMqttAndSettings1792643048930 implements MigrationInterface {
    name = 'AddMqttAndSettings1792643048930'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "app_settings" ("key" varchar PRIMARY KEY NOT NULL, "value" text NOT NULL, "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`DROP INDEX "IDX_114b49a5a43e1c70244c95085a"`);
        await queryRunner.query(`CREATE TABLE "temporary_sensor_readings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "temperature" real, "humidity" real, "soilMoisture" real, "lightLux" real, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "source" varchar NOT NULL DEFAULT ('http'), CONSTRAINT "FK_ae954847a60a3a5c28a29f7cc99" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "temporary_sensor_readings"("id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt") SELECT "id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt" FROM "sensor_readings"`);
        await queryRunner.query(`DROP TABLE "sensor_readings"`);
        await queryRunner.query(`ALTER TABLE "temporary_sensor_readings" RENAME TO "sensor_readings"`);
        await queryRunner.query(`CREATE INDEX "IDX_114b49a5a43e1c70244c95085a" ON "sensor_readings" ("deviceId", "createdAt") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_114b49a5a43e1c70244c95085a"`);
        await queryRunner.query(`ALTER TABLE "sensor_readings" RENAME TO "temporary_sensor_readings"`);
        await queryRunner.query(`CREATE TABLE "sensor_readings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "deviceId" integer NOT NULL, "temperature" real, "humidity" real, "soilMoisture" real, "lightLux" real, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_ae954847a60a3a5c28a29f7cc99" FOREIGN KEY ("deviceId") REFERENCES "devices" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`);
        await queryRunner.query(`INSERT INTO "sensor_readings"("id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt") SELECT "id", "deviceId", "temperature", "humidity", "soilMoisture", "lightLux", "createdAt" FROM "temporary_sensor_readings"`);
        await queryRunner.query(`DROP TABLE "temporary_sensor_readings"`);
        await queryRunner.query(`CREATE INDEX "IDX_114b49a5a43e1c70244c95085a" ON "sensor_readings" ("deviceId", "createdAt") `);
        await queryRunner.query(`DROP TABLE "app_settings"`);
    }

}
