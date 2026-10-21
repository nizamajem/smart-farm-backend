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
}
