import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { ActivityService } from './activity.service';
import { Client, ClientInfo } from './client-info.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** Dipanggil web & aplikasi mobile saat dibuka. Platform/versi dari header x-client & x-app-version. */
  @Post('activity/app-open')
  @HttpCode(200)
  appOpen(@CurrentUser() user: JwtUser, @Client() client: ClientInfo) {
    return this.activity.appOpen(user.sub, client);
  }

  @Get('users/:id/activity')
  @UseGuards(RolesGuard)
  @Roles('admin')
  list(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const allowed = ['login', 'app_open', 'action'];
    return this.activity.list(id, {
      type: type && allowed.includes(type) ? type : undefined,
      limit: limit ? Number(limit) : undefined,
      before: before ? Number(before) : undefined,
    });
  }

  @Get('users/:id/activity/summary')
  @UseGuards(RolesGuard)
  @Roles('admin')
  summary(@Param('id', ParseIntPipe) id: number) {
    return this.activity.summary(id);
  }
}
