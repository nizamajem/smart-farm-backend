import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { Client, ClientInfo } from '../activity/client-info.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { HomeAssistantService } from '../home-assistant/home-assistant.service';
import { logHub } from '../logs/log-hub';
import { MqttService } from '../mqtt/mqtt.service';
import { SettingsService } from '../settings/settings.service';

/** Status & saklar jalur data: MQTT langsung dan Home Assistant (bisa aktif bersamaan). */
@Controller('integrations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class IntegrationsController {
  constructor(
    private readonly mqtt: MqttService,
    private readonly ha: HomeAssistantService,
    private readonly activity: ActivityService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async status() {
    return {
      mqtt: {
        enabled: await this.settings.getBool('mqtt.enabled'),
        ...this.mqtt.status(),
        publicHost: process.env.MQTT_PUBLIC_HOST || null,
        publicPort: Number(process.env.MQTT_PUBLIC_PORT ?? this.mqtt.status().tcpPort),
        // Akun pemantau untuk tim HW (halaman ini khusus admin)
        adminPassword: process.env.MQTT_ADMIN_USERNAME ? process.env.MQTT_ADMIN_PASSWORD || null : null,
      },
      homeAssistant: {
        enabled: await this.ha.isEnabled(),
        configured: this.ha.configured,
        baseUrl: (process.env.HA_BASE_URL ?? '').replace(/\/+$/, '') || null,
        intervalSec: this.ha.intervalSec,
        lastSyncAt: this.ha.lastSyncAt,
        lastSyncResult: this.ha.lastSyncResult,
        lastSyncError: this.ha.lastSyncError,
      },
    };
  }

  @Put(':name')
  async toggle(
    @CurrentUser() user: JwtUser,
    @Param('name') name: string,
    @Body() body: { enabled?: unknown },
    @Client() client: ClientInfo,
  ) {
    if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled harus true/false');
    const on = body.enabled;
    if (name === 'mqtt') {
      try {
        await this.mqtt.setEnabled(on);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    } else if (name === 'home-assistant') {
      await this.ha.setEnabled(on);
    } else {
      throw new BadRequestException('Integrasi tidak dikenal');
    }
    const label = name === 'mqtt' ? 'MQTT' : 'Home Assistant';
    logHub.push(name === 'mqtt' ? 'mqtt' : 'ha', on ? 'info' : 'warn', 'Integrasi', `Saklar ${label} ${on ? 'ON' : 'OFF'} oleh ${user.email}`);
    await this.activity.action(user.sub, `integration.${on ? 'enable' : 'disable'}`, `${on ? 'Mengaktifkan' : 'Mematikan'} jalur ${label}`, {
      client,
    });
    return this.status();
  }
}
