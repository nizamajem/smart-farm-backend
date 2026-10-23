import { IsOptional, IsString, Matches } from 'class-validator';

// entity_id HA, mis. "sensor.greenhouse_suhu". String kosong = hapus pemetaan.
const ENTITY_ID = /^([a-z_]+\.[a-z0-9_]+)?$/;
const MSG = 'harus berupa entity_id Home Assistant, mis. sensor.greenhouse_suhu';

export class HaEntitiesDto {
  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `temperature ${MSG}` })
  temperature?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `humidity ${MSG}` })
  humidity?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `soilMoisture ${MSG}` })
  soilMoisture?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `lightLux ${MSG}` })
  lightLux?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `ph ${MSG}` })
  ph?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `orp ${MSG}` })
  orp?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `conductivity ${MSG}` })
  conductivity?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `tds ${MSG}` })
  tds?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `salinity ${MSG}` })
  salinity?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `specificGravity ${MSG}` })
  specificGravity?: string;

  @IsOptional()
  @IsString()
  @Matches(ENTITY_ID, { message: `conductivityFactor ${MSG}` })
  conductivityFactor?: string;
}
