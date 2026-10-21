import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/** Konfigurasi DB bersama untuk aplikasi Nest dan CLI TypeORM (migration). */
export const databaseOptions = (): DataSourceOptions => ({
  type: 'better-sqlite3',
  database: process.env.DB_PATH ?? 'smartfarm.sqlite',
  entities: [join(__dirname, '**/*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
  // Skema dikelola lewat migration, bukan synchronize.
  synchronize: false,
});
