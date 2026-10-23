import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Device } from './device.entity';

export type ReadingSource = 'http' | 'mqtt' | 'ha';

@Entity('sensor_readings')
@Index(['deviceId', 'createdAt'])
export class SensorReading {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  deviceId: number;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  /** °C */
  @Column('real', { nullable: true })
  temperature: number | null;

  /** % RH */
  @Column('real', { nullable: true })
  humidity: number | null;

  /** % kelembapan tanah */
  @Column('real', { nullable: true })
  soilMoisture: number | null;

  /** lux */
  @Column('real', { nullable: true })
  lightLux: number | null;

  @Column('real', { nullable: true })
  ph: number | null;

  @Column('real', { nullable: true })
  orp: number | null;

  @Column('real', { nullable: true })
  conductivity: number | null;

  @Column('real', { nullable: true })
  tds: number | null;

  @Column('real', { nullable: true })
  salinity: number | null;

  @Column('real', { nullable: true })
  specificGravity: number | null;

  @Column('real', { nullable: true })
  conductivityFactor: number | null;

  /** Jalur masuk data: http (ESP32 REST), mqtt, atau ha (Home Assistant) */
  @Column({ type: 'varchar', default: 'http' })
  source: ReadingSource;

  @CreateDateColumn()
  createdAt: Date;
}
