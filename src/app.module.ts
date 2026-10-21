import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { databaseOptions } from './database.config';
import { DevicesModule } from './devices/devices.module';
import { HealthController } from './health.controller';
import { HomeAssistantModule } from './home-assistant/home-assistant.module';
import { IotModule } from './iot/iot.module';
import { SeedService } from './seed/seed.service';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      // Migration yang belum jalan dieksekusi otomatis saat start (deploy juga menjalankannya eksplisit).
      useFactory: () => ({ ...databaseOptions(), migrationsRun: true }),
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as any },
      }),
    }),
    UsersModule,
    AuthModule,
    DevicesModule,
    IotModule,
    HomeAssistantModule,
  ],
  controllers: [HealthController],
  providers: [SeedService],
})
export class AppModule {}
