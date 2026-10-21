import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { Device } from './devices/device.entity';
import { DevicesModule } from './devices/devices.module';
import { RelayCommand } from './devices/relay-command.entity';
import { SensorReading } from './devices/sensor-reading.entity';
import { IotModule } from './iot/iot.module';
import { SeedService } from './seed/seed.service';
import { User } from './users/user.entity';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'better-sqlite3',
        database: process.env.DB_PATH ?? 'smartfarm.sqlite',
        entities: [User, Device, SensorReading, RelayCommand],
        synchronize: true,
      }),
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
  ],
  providers: [SeedService],
})
export class AppModule {}
