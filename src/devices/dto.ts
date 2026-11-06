import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MAX_ON_MS = 3000;

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateDeviceDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  relayLabels?: string[];
}

export class UpdateDeviceDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @Transform(trim)
  @IsString()
  @MaxLength(255)
  location: string;
}

export class CreateCommandDto {
  @IsInt()
  @Min(1)
  @Max(4)
  relay: number;

  @IsIn(['ON', 'OFF'])
  action: 'ON' | 'OFF';

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(MAX_ON_MS)
  durationMs?: number;
}

export class ReadingsQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

export class CreateReadingDto {
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  humidity?: number;

  @IsOptional()
  @IsNumber()
  soilMoisture?: number;

  @IsOptional()
  @IsNumber()
  lightLux?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(14)
  ph?: number;

  @IsOptional()
  @IsNumber()
  orp?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  conductivity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tds?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salinity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  specificGravity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  conductivityFactor?: number;
}
