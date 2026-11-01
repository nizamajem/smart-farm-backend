import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddNutrientRecipeAndEnergy1793577600000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    for (const col of ['haMcbSensors', 'nutrientRecipe', 'lastMix']) await r.query(`ALTER TABLE "devices" ADD COLUMN "${col}" text`);
  }
  async down(r: QueryRunner): Promise<void> {
    for (const col of ['lastMix', 'nutrientRecipe', 'haMcbSensors']) await r.query(`ALTER TABLE "devices" DROP COLUMN "${col}"`);
  }
}
