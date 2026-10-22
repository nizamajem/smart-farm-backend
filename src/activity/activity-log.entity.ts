import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

/** login | login_failed | app_open | action */
export type ActivityType = 'login' | 'login_failed' | 'app_open' | 'action';

/** Jejak aktivitas pengguna: login, membuka aplikasi, dan aksi (mis. menyalakan pompa). */
@Entity('activity_logs')
@Index(['userId', 'createdAt'])
export class ActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar' })
  type: ActivityType;

  /** Kode aksi, mis. relay.on, device.create (hanya untuk type=action) */
  @Column({ type: 'varchar', nullable: true })
  action: string | null;

  /** Kalimat yang mudah dibaca admin, mis. "Menyalakan Pompa Air di Greenhouse 1" */
  @Column()
  description: string;

  /** Perangkat terkait (tanpa foreign key agar log tetap ada walau perangkat dihapus) */
  @Column({ type: 'integer', nullable: true })
  deviceId: number | null;

  /** web | android | ios */
  @Column({ type: 'varchar', nullable: true })
  platform: string | null;

  @Column({ type: 'varchar', nullable: true })
  appVersion: string | null;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column('simple-json', { nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
