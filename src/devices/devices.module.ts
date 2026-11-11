import { PanelAccessoriesService } from './panel-accessories.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceEvents } from './device-events';
import { Device } from './device.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { RelayCommand } from './relay-command.entity';
import { SensorReading } from './sensor-reading.entity';
import { HaRelayService } from '../home-assistant/ha-relay.service';
import { NutrientsService } from './nutrients.service';
import { NutrientsController } from './nutrients.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Device, SensorReading, RelayCommand])],
  controllers: [DevicesController, NutrientsController],
  providers: [PanelAccessoriesService, DevicesService, DeviceEvents, HaRelayService, NutrientsService],
  exports: [DevicesService, DeviceEvents, HaRelayService, TypeOrmModule],
})
export class DevicesModule {}
