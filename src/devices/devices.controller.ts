import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { CreateCommandDto, CreateDeviceDto, ReadingsQueryDto } from './dto';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtUser) {
    return this.devices.findAllFor(user);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateDeviceDto) {
    return this.devices.create(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.devices.findOneFor(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.devices.remove(user, id);
  }

  @Get(':id/readings')
  readings(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ReadingsQueryDto,
  ) {
    return this.devices.readingsFor(user, id, query.limit);
  }

  @Get(':id/commands')
  commands(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return this.devices.commandsFor(user, id);
  }

  @Post(':id/commands')
  queueCommand(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommandDto,
  ) {
    return this.devices.queueCommand(user, id, dto);
  }
}
