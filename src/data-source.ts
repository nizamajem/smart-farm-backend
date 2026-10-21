// Entry point CLI TypeORM: npm run migration:generate / migration:run
import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database.config';

config();

export default new DataSource(databaseOptions());
