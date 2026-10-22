import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Role = 'admin' | 'user';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar', default: 'user' })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  /** Terakhir ada aktivitas / request (diperbarui maks. sekali per menit) */
  @Column({ type: 'datetime', nullable: true })
  lastSeenAt: Date | null;
}
