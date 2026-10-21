import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { HomeAssistantController } from './home-assistant.controller';
import { HomeAssistantService } from './home-assistant.service';

@Module({
  imports: [DevicesModule],
  controllers: [HomeAssistantController],
  providers: [HomeAssistantService],
  exports: [HomeAssistantService],
})
export class HomeAssistantModule {}
