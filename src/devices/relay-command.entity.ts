import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Device } from './device.entity';

export type RelayAction = 'ON' | 'OFF';
/** pending → sent (diambil ESP32) → done (ESP32 konfirmasi). expired bila tidak diambil tepat waktu. */
export type CommandStatus = 'pending' | 'sent' | 'done' | 'expired';

@Entity('relay_commands')
export class RelayCommand {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  deviceId: number;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  /** 1..4, sesuai relay di firmware */
  @Column('integer')
  relay: number;

  @Column({ type: 'varchar' })
  action: RelayAction;

  /** Lama ON dalam ms; firmware membatasi maksimal 3000 ms. */
  @Column('integer', { default: 0 })
  durationMs: number;

  @Column({ type: 'varchar', default: 'pending' })
  status: CommandStatus;

  @Column({ nullable: true })
  requestedById: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'requestedById' })
  requestedBy: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  ackAt: Date | null;
}
