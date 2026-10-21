import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';

/** Autentikasi ESP32 lewat header `x-device-key`. Menaruh perangkat di `req.device`. */
@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(private readonly devices: DevicesService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-device-key'];
    const device = typeof key === 'string' && key ? await this.devices.findByApiKey(key) : null;
    if (!device) throw new UnauthorizedException('Device key tidak valid');
    req.device = device;
    return true;
  }
}
