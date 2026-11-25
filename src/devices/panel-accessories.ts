import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsOptional, IsString, Matches, MaxLength, IsNumber, ValidateNested } from 'class-validator';

export class AccessoryMapping {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @Matches(/^switch\.[a-z0-9_]+$|^$/) entity?: string;
  @IsOptional() @Matches(/^(sensor|binary_sensor)\.[a-z0-9_]+$|^$/) status?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) depth?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) moisture?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) temperature?: string;
}

export class TankMapping {
  @IsIn(['main', 'a', 'b']) key: 'main' | 'a' | 'b';
  @IsString() @Matches(/^sensor\.[a-z0-9_]+$|^$/) entity: string;
  @IsIn(['percent', 'calibrated']) mode: 'percent' | 'calibrated';
  @IsOptional() @IsNumber() emptyValue?: number;
  @IsOptional() @IsNumber() fullValue?: number;
}

export class PanelAccessories {
  @IsOptional() @ValidateNested() @Type(() => AccessoryMapping) curtain?: AccessoryMapping;
  @IsOptional() @IsArray() @ArrayMinSize(3) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => TankMapping) tanks?: TankMapping[];
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => AccessoryMapping)
  plugs: AccessoryMapping[];
  @IsDefined() @ValidateNested() @Type(() => AccessoryMapping) level: AccessoryMapping;
  @IsDefined() @ValidateNested() @Type(() => AccessoryMapping) valve: AccessoryMapping;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => AccessoryMapping)
  soils: AccessoryMapping[];
}

export class AccessoryCommand {
  @IsIn(['plug1', 'plug2', 'valve', 'curtain']) key: 'plug1' | 'plug2' | 'valve' | 'curtain';
  @IsIn(['ON', 'OFF']) action: 'ON' | 'OFF';
}

export const defaultAccessories = (): PanelAccessories => ({
  plugs: [{ name: 'Pompa Air Utama' }, { name: 'Pompa Sirkulasi' }],
  curtain: { name: 'Tirai GH' },
  tanks: defaultTanks(),
  level: { name: 'Level Air' }, valve: { name: 'Katup Air Tandon' },
  soils: [{ name: 'Soil Sensor 1' }],
});

export const defaultTanks = (): TankMapping[] => ['main', 'a', 'b'].map(key => ({ key: key as TankMapping['key'], entity: '', mode: 'percent' }));
