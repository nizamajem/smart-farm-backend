import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { HaEntitiesDto } from './dto';
import { HomeAssistantService } from './home-assistant.service';

@Controller('home-assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class HomeAssistantController {
  constructor(private readonly ha: HomeAssistantService) {}

  @Get('health')
  health() {
    return this.ha.health();
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
  setDeviceEntities(@Param('id', ParseIntPipe) id: number, @Body() dto: HaEntitiesDto) {
    return this.ha.setDeviceEntities(id, dto);
  }

  @Post('sync')
  @HttpCode(200)
  sync() {
    return this.ha.sync();
  }
}
