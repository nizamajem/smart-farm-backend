import { Type } from 'class-transformer';
import { IsArray, ArrayMaxSize, ValidateNested, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
export class HstStage {
  @IsInt() @Min(0) @Max(3650) fromDay: number;
  @IsInt() @Min(0) @Max(3650) toDay: number;
  @IsNumber() @Min(1) @Max(10000) targetPpm: number;
  @IsNumber() @Min(0.01) @Max(13.99) targetPh: number;
}
export class AutomaticNutrientsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(() => HstStage) stages?: HstStage[];
  @IsBoolean() enabled: boolean;
  @IsBoolean() ppmEnabled: boolean;
  @IsBoolean() phEnabled: boolean;
  @IsNumber() @Min(1) @Max(10000) targetPpm: number;
  @IsNumber() @Min(0.01) @Max(13.99) targetPh: number;
  @IsNumber() @Min(1) @Max(1000) ppmTolerance: number;
  @IsNumber() @Min(0.01) @Max(2) phTolerance: number;
  @IsNumber() @Min(0.01) @Max(1000000) abDoseLiters: number;
  @IsNumber() @Min(0.001) @Max(1000000) phDoseMl: number;
  @IsInt() @Min(60) @Max(3600) settleSeconds: number;
  @IsInt() @Min(1) @Max(100) maxCycles: number;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) plantedOn?: string;
}
export type AutomaticState = { cycles: number; message: string; lastReadingId?: number; lastSensorReport?: string; waitUntil?: string; phase?: 'ppm' | 'ph'; };
export function plantAge(plantedOn?: string, now = new Date()): number | null {
  if (!plantedOn) return null;
  const date = Date.parse(`${plantedOn}T00:00:00+08:00`);
  const today = new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  return Number.isFinite(date) ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00+08:00`)-date)/86400000)) : null;
}
