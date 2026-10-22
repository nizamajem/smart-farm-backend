import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Pengaturan yang bisa diubah admin saat aplikasi berjalan (mis. saklar integrasi). */
@Entity('app_settings')
export class AppSetting {
  @PrimaryColumn()
  key: string;

  @Column('simple-json')
  value: unknown;

  @UpdateDateColumn()
  updatedAt: Date;
}
