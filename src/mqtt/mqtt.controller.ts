import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { DevicesService } from '../devices/devices.service';
import { deviceUsername, MqttService, TOPIC_PREFIX, WS_PATH } from './mqtt.service';

/** Kredensial MQTT per perangkat — untuk diserahkan ke tim hardware. */
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class MqttController {
  constructor(
    private readonly devices: DevicesService,
    private readonly mqtt: MqttService,
  ) {}

  @Get(':id/mqtt')
  async credentials(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    const device = await this.devices.getOwned(user, id);
    const base = `${TOPIC_PREFIX}/${device.id}`;
    const status = this.mqtt.status();
    return {
      enabled: status.running,
      connected: this.mqtt.isDeviceConnected(device.id),
      tcp: { host: process.env.MQTT_PUBLIC_HOST || null, port: Number(process.env.MQTT_PUBLIC_PORT ?? status.tcpPort) },
      wsPath: WS_PATH,
      username: deviceUsername(device.id),
      password: device.apiKey,
      clientIdHint: `smartfarm-${device.id}`,
      topics: {
        telemetry: `${base}/telemetry`,
        status: `${base}/status`,
        command: `${base}/cmd`,
        ack: `${base}/cmd/ack`,
      },
      examples: {
        telemetry: { temperature: 27.5, humidity: 70, soilMoisture: 55, lightLux: 12000 },
        command: { id: 42, relay: 1, action: 'ON', durationMs: 3000 },
        ack: { id: 42 },
      },
    };
  }
}
