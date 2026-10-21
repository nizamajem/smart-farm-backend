import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Role = 'admin' | 'farmer';

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

  @Column({ type: 'varchar', default: 'farmer' })
  role: Role;

  @CreateDateColumn()
  createdAt: Date;
}
