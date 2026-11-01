import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { Client, ClientInfo } from '../activity/client-info.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { HaEntitiesDto, HaRelaysDto, HaMcbDto, HaMcbCommandDto, HaMcbSensorsDto } from './dto';
import { HomeAssistantService } from './home-assistant.service';
import { HaRelayService } from './ha-relay.service';
import { DevicesService } from '../devices/devices.service';

@Controller('home-assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class HomeAssistantController {
  constructor(
    private readonly ha: HomeAssistantService,
    private readonly activity: ActivityService,
    private readonly relays: HaRelayService,
    private readonly devices: DevicesService,
  ) {}

  @Get('health')
  health() {
    return this.ha.health();
  }

  @Get('relay-entities')
  relayEntities() {
    return this.relays.choices();
  }

  @Get('devices/:id/mcb')
  @Roles('admin', 'user')
  async mcbStatus(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.relays.mcbStatus(await this.devices.getOwned(user, id));
  }

  @Put('devices/:id/mcb')
  async setMcb(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HaMcbDto, @Client() client: ClientInfo) {
    await this.devices.getOwned(user, id);
    const device = await this.relays.saveMcbMapping(id, dto.entityId);
    await this.activity.action(user.sub, 'ha.mcb-mapping', `Mengubah Smart MCB untuk "${device.name}"`, { deviceId: id, client });
    return device;
  }

  @Post('devices/:id/mcb/command')
  @Roles('admin', 'user')
  async commandMcb(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HaMcbCommandDto, @Client() client: ClientInfo) {
    await this.devices.getOwned(user, id);
    const result = await this.relays.executeMcb(id, dto.action);
    await this.activity.action(user.sub, 'ha.mcb-command', `Smart MCB ${dto.action}`, { deviceId: id, client });
    return result;
  }

  @Put('devices/:id/mcb/sensors')
  async setMcbSensors(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HaMcbSensorsDto, @Client() client: ClientInfo) {
    await this.devices.getOwned(user, id);
    const device = await this.relays.saveMcbSensors(id, dto);
    await this.activity.action(user.sub, 'ha.mcb-sensors', 'Mengubah sensor listrik panel', { deviceId: id, client });
    return device;
  }

  @Get('devices/:id/relays')
  @Roles('admin', 'user')
  async relayStatus(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.relays.status(await this.devices.getOwned(user, id));
  }

  @Put('devices/:id/relays')
  async setRelays(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: HaRelaysDto, @Client() client: ClientInfo) {
    const device = await this.relays.saveMapping(id, dto);
    await this.activity.action(user.sub, 'ha.relay-mapping', `Mengubah pemetaan relay Home Assistant untuk "${device.name}"`, {
      deviceId: id, client, meta: { haRelays: device.haRelays },
    });
    return device;
  }

  /** ?domain=sensor untuk menyaring entity */
  @Get('states')
  states(@Query('domain') domain?: string) {
    return this.ha.states(domain);
  }

  @Get('states/:entityId')
  state(@Param('entityId') entityId: string) {
    return this.ha.state(entityId);
  }

  @Get('sensors')
  sensors(@Query('ids') ids?: string) {
    if (!ids) return [];
    return this.ha.sensors(ids.split(',').map((id) => id.trim()));
  }

  @Get('history/:entityId')
  history(@Param('entityId') entityId: string, @Query('start') start?: string, @Query('end') end?: string) {
    return this.ha.history(entityId, start, end);
  }

  @Put('devices/:id')
  async setDeviceEntities(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HaEntitiesDto,
    @Client() client: ClientInfo,
  ) {
    const device = await this.ha.setDeviceEntities(id, dto);
    await this.activity.action(user.sub, 'ha.mapping', `Mengubah sensor Home Assistant untuk "${device.name}"`, {
      deviceId: id,
      client,
      meta: { haEntities: device.haEntities },
    });
    return device;
  }

  @Post('sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: JwtUser, @Client() client: ClientInfo) {
    const result = await this.ha.sync();
    await this.activity.action(user.sub, 'ha.sync', 'Mengambil data terbaru dari Home Assistant', { client, meta: result });
    return result;
  }
}
