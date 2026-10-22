import { Module } from '@nestjs/common';
import { HomeAssistantModule } from '../home-assistant/home-assistant.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { IntegrationsController } from './integrations.controller';

@Module({
  imports: [MqttModule, HomeAssistantModule],
  controllers: [IntegrationsController],
})
export class IntegrationsModule {}
