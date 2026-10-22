import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceEvents } from './device-events';
import { Device } from './device.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { RelayCommand } from './relay-command.entity';
import { SensorReading } from './sensor-reading.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Device, SensorReading, RelayCommand])],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceEvents],
  exports: [DevicesService, DeviceEvents, TypeOrmModule],
})
export class DevicesModule {}
