import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

export class AccessoryMapping {
  @IsString() @MaxLength(80) name: string;
  @IsOptional() @Matches(/^switch\.[a-z0-9_]+$|^$/) entity?: string;
  @IsOptional() @Matches(/^(sensor|binary_sensor)\.[a-z0-9_]+$|^$/) status?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) depth?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) moisture?: string;
  @IsOptional() @Matches(/^sensor\.[a-z0-9_]+$|^$/) temperature?: string;
}

export class PanelAccessories {
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => AccessoryMapping)
  plugs: AccessoryMapping[];
  @IsDefined() @ValidateNested() @Type(() => AccessoryMapping) level: AccessoryMapping;
  @IsDefined() @ValidateNested() @Type(() => AccessoryMapping) valve: AccessoryMapping;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => AccessoryMapping)
  soils: AccessoryMapping[];
}

export class AccessoryCommand {
  @IsIn(['plug1', 'plug2', 'valve']) key: 'plug1' | 'plug2' | 'valve';
  @IsIn(['ON', 'OFF']) action: 'ON' | 'OFF';
}

export const defaultAccessories = (): PanelAccessories => ({
  plugs: [{ name: 'Smart Plug 1' }, { name: 'Smart Plug 2' }],
  level: { name: 'Level Air' }, valve: { name: 'Smart Valve' },
  soils: [{ name: 'Soil Sensor 1' }],
});
