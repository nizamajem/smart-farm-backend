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

export const HA_METRICS = ['temperature', 'humidity', 'soilMoisture', 'lightLux'] as const;
export type HaMetric = (typeof HA_METRICS)[number];
/** Metrik sensor → entity_id Home Assistant, mis. { temperature: 'sensor.greenhouse_suhu' } */
export type HaEntityMap = Partial<Record<HaMetric, string>>;

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
