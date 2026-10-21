import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

/** Satu file APK aplikasi mobile yang diunggah admin. Rilis terbaru = yang bisa diunduh di halaman login. */
@Entity('app_releases')
export class AppRelease {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  version: string;

  @Column({ default: '' })
  notes: string;

  /** Nama berkas di folder rilis (bukan nama asli dari pengunggah) */
  @Column()
  fileName: string;

  @Column('integer')
  size: number;

  @Column()
  sha256: string;

  @Column('integer', { default: 0 })
  downloads: number;

  @Column({ type: 'integer', nullable: true })
  uploadedById: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploadedById' })
  uploadedBy: User | null;

  @CreateDateColumn()
  createdAt: Date;
}
