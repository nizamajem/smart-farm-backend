import { Type } from 'class-transformer';
import { IsArray, ArrayMaxSize, ValidateNested, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
export class NutrientRange {
  @IsOptional() @IsNumber() @Min(1) @Max(10000) ppmMin?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(10000) ppmMax?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(13.99) phMin?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(13.99) phMax?: number;
}
export class HstStage extends NutrientRange {
  @IsInt() @Min(0) @Max(3650) fromDay: number;
  @IsInt() @Min(0) @Max(3650) toDay: number;
  @IsOptional() @IsNumber() @Min(1) @Max(10000) targetPpm: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(13.99) targetPh: number;
}
export class AutomaticNutrientsDto extends NutrientRange {
  @IsOptional() @IsInt() @Min(0) @Max(3650) fromDay?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) toDay?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(() => HstStage) stages?: HstStage[];
  @IsBoolean() enabled: boolean;
  @IsBoolean() ppmEnabled: boolean;
  @IsBoolean() phEnabled: boolean;
  @IsOptional() @IsNumber() @Min(1) @Max(10000) targetPpm: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(13.99) targetPh: number;
  @IsOptional() @IsNumber() @Min(0.0001) @Max(10000) ppmTolerance: number;
  @IsOptional() @IsNumber() @Min(0.0001) @Max(14) phTolerance: number;
  @IsNumber() @Min(0.01) @Max(1000000) abDoseLiters: number;
  @IsNumber() @Min(0.001) @Max(1000000) phDoseMl: number;
  @IsInt() @Min(60) @Max(3600) settleSeconds: number;
  @IsInt() @Min(1) @Max(100) maxCycles: number;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) plantedOn?: string;
}
export type AutomaticState = { cycles: number; ppmCorrecting?: boolean; message: string; lastReadingId?: number; lastSensorReport?: string; waitUntil?: string; phase?: 'ppm' | 'ph'; };
export function plantAge(plantedOn?: string, now = new Date()): number | null {
  if (!plantedOn) return null;
  const date = Date.parse(`${plantedOn}T00:00:00+08:00`);
  const today = new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  return Number.isFinite(date) ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00+08:00`)-date)/86400000)) : null;
}

export function nutrientRange(c: NutrientRange & {targetPpm?:number;targetPh?:number;ppmTolerance?:number;phTolerance?:number}) {
  const ppm=c.targetPpm ?? 800, ph=c.targetPh ?? 6;
  return {ppmMin:c.ppmMin ?? ppm-(c.ppmTolerance ?? 20), ppmMax:c.ppmMax ?? ppm+(c.ppmTolerance ?? 20), phMin:c.phMin ?? ph-(c.phTolerance ?? 0.1), phMax:c.phMax ?? ph+(c.phTolerance ?? 0.1)};
}
