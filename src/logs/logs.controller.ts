import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { LogChannel, logHub } from './log-hub';

const CHANNELS: LogChannel[] = ['system', 'mqtt', 'ha'];

function channelOf(name: string): LogChannel {
  if (!CHANNELS.includes(name as LogChannel)) throw new BadRequestException('Kanal log: system, mqtt, atau ha');
  return name as LogChannel;
}

/** Log mentah untuk admin: umum (server), MQTT, Home Assistant. */
@Controller('logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LogsController {
  @Get()
  stats() {
    return logHub.stats();
  }

  /** ?after=<id> untuk mengambil yang baru saja (tampilan live). */
  @Get(':channel')
  read(@Param('channel') channel: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return logHub.read(channelOf(channel), Number(after) || 0, Math.min(Number(limit) || 500, 2000));
  }

  @Delete(':channel')
  @HttpCode(200)
  clear(@Param('channel') channel: string) {
    logHub.clear(channelOf(channel));
    return { ok: true };
  }
}
