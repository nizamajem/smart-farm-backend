import { IsIn, IsInt, Min, Max, IsOptional, IsString, Matches } from 'class-validator';

export class HaManualRelayDto {
  @IsInt() @Min(1) @Max(4) relay: number;
  @IsIn(['ON', 'OFF']) action: 'ON' | 'OFF';
}

export class HaMcbDto {
  @IsString()
  @Matches(/^(?:switch\.[a-z0-9_]+)?$/)
  entityId: string;
}

export class HaMcbCommandDto {
  @IsIn(['ON', 'OFF'])
  action: 'ON' | 'OFF';
}

export class HaMcbSensorsDto {
  @IsString()
  @Matches(/^(?:sensor\.[a-z0-9_]+)?$/)
  power: string;
  @IsString()
  @Matches(/^(?:sensor\.[a-z0-9_]+)?$/)
  energy: string;
  @IsOptional() @IsString() @Matches(/^(?:sensor\.[a-z0-9_]+)?$/) voltage?: string;
  @IsOptional() @IsString() @Matches(/^(?:sensor\.[a-z0-9_]+)?$/) current?: string;
}

// entity_id HA, mis. "sensor.greenhouse_suhu". String kosong = hapus pemetaan.
const ENTITY_ID = /^([a-z_]+\.[a-z0-9_]+)?$/;
const MSG = 'harus berupa entity_id Home Assistant, mis. sensor.greenhouse_suhu';

const RELAY_ENTITY = /^(?:(?:switch|light)\.[a-z0-9_]+)?$/;
export class HaRelaysDto {
  @IsString()
  @Matches(RELAY_ENTITY)
  relay1: string;

  @IsString()
  @Matches(RELAY_ENTITY)
  relay2: string;

  @IsString()
  @Matches(RELAY_ENTITY)
  relay3: string;

  @IsString()
  @Matches(RELAY_ENTITY)
  relay4: string;
}

export class HaEntitiesDto {
  @IsOptional() @IsString() @Matches(ENTITY_ID) flowIn?: string;
  @IsOptional() @IsString() @Matches(ENTITY_ID) flowOut?: string;
  @IsOptional() @IsString() @Matches(ENTITY_ID) flowOutTotal?: string;
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
