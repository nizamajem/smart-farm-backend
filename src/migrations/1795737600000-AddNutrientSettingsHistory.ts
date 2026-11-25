import {MigrationInterface,QueryRunner} from 'typeorm';
export class AddNutrientSettingsHistory1795737600000 implements MigrationInterface {
 async up(q:QueryRunner):Promise<void>{await q.query('ALTER TABLE "devices" ADD COLUMN "nutrientSettingsHistory" text');}
 async down(q:QueryRunner):Promise<void>{await q.query('ALTER TABLE "devices" DROP COLUMN "nutrientSettingsHistory"');}
}
