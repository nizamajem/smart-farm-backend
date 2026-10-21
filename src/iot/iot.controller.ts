import {
  Body,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Device } from '../devices/device.entity';
import { DevicesService } from '../devices/devices.service';
import { CreateReadingDto } from '../devices/dto';
import { DeviceKeyGuard } from './device-key.guard';

const CurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Device => ctx.switchToHttp().getRequest().device,
);

/** Endpoint yang dipanggil firmware ESP32. */
@Controller('iot')
@UseGuards(DeviceKeyGuard)
export class IotController {
  constructor(private readonly devices: DevicesService) {}

  @Post('readings')
  async reading(@CurrentDevice() device: Device, @Body() dto: CreateReadingDto) {
    const saved = await this.devices.recordReading(device, dto);
    return { ok: true, id: saved.id };
  }

  @Get('commands')
  commands(@CurrentDevice() device: Device) {
    return this.devices.pullCommands(device);
  }

  @Post('commands/:id/ack')
  async ack(@CurrentDevice() device: Device, @Param('id', ParseIntPipe) id: number) {
    await this.devices.ackCommand(device, id);
    return { ok: true };
  }
}
