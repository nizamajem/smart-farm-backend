import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export const DEFAULT_RELAY_LABELS = ['Pompa Air', 'Kipas', 'Lampu Tumbuh', 'Pompa Nutrisi'];

export const HA_METRICS = ['temperature', 'humidity', 'soilMoisture', 'lightLux', 'ph', 'orp', 'conductivity', 'tds', 'salinity', 'specificGravity', 'conductivityFactor', 'flowIn', 'flowOut', 'flowOutTotal'] as const;
export type HaMetric = (typeof HA_METRICS)[number];
/** Metrik sensor → entity_id Home Assistant, mis. { temperature: 'sensor.greenhouse_suhu' } */
export type HaEntityMap = Partial<Record<HaMetric, string>>;
export const RELAY_KEYS = ['relay1', 'relay2', 'relay3', 'relay4'] as const;
export type HaRelayMap = Partial<Record<(typeof RELAY_KEYS)[number], string>>;

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ default: '' })
  location: string;

  /** Kunci yang ditanam di firmware ESP32, dikirim lewat header x-device-key. */
  @Column({ unique: true })
  apiKey: string;

  @Column('simple-json')
  relayLabels: string[];

  /** Bila diisi, data sensor perangkat ini diambil berkala dari Home Assistant. */
  @Column('simple-json', { nullable: true })
  haEntities: HaEntityMap | null;

  @Column('simple-json', { nullable: true })
  haRelays: HaRelayMap | null;

  @Column({ type: 'varchar', nullable: true })
  haMcbEntity: string | null;

  @Column('simple-json', { nullable: true })
  haMcbSensors: { power?: string; energy?: string; voltage?: string; current?: string } | null;

  @Column('simple-json', { nullable: true })
  accessories: import('./panel-accessories').PanelAccessories | null;

  @Column('simple-json', { nullable: true })
  nutrientRecipe: { liters: number; aSeconds: number; bSeconds: number } | { version: 2; waterLiters: number; aMl: number; bMl: number; crop?: string; plantAgeDays?: number; targetTds?: number; targetPh?: number } | null;

  @Column('simple-json', { nullable: true })
  dosingPumps: Partial<Record<'a' | 'b' | 'phUp' | 'phDown', { seconds: number; ml: number }>> | null;

  @Column('simple-json', { nullable: true })
  lastMix: { requestId: string; mode?: 'initial' | 'correction'; status: string; liters: number; aSeconds: number; bSeconds: number; aMl?: number; bMl?: number; phase?: 'a' | 'b' | 'ab' | 'finishing'; completedChannels?: string[]; recipe?: { version: 2; waterLiters: number; aMl: number; bMl: number; crop?: string; plantAgeDays?: number; targetTds?: number; targetPh?: number } | null; phaseStartedAt?: string; startedAt: string; finishedAt?: string; error?: string } | null;

  @Column('simple-json', { nullable: true })
  lastPhDose: { requestId: string; channel: 'phUp' | 'phDown'; ml: number; seconds: number; status: string; startedAt: string; finishedAt?: string; error?: string } | null;

  @Column()
  ownerId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
