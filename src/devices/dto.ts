import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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
}
