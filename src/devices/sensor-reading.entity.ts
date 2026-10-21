import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Device } from './device.entity';

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

  @CreateDateColumn()
  createdAt: Date;
}
