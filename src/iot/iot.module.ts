import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { DeviceKeyGuard } from './device-key.guard';
import { IotController } from './iot.controller';

@Module({
  imports: [DevicesModule],
  controllers: [IotController],
  providers: [DeviceKeyGuard],
})
export class IotModule {}
