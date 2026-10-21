import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../users/user.entity';

export interface JwtUser {
  sub: number;
  email: string;
  name: string;
  role: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException('Token tidak ada');
    try {
      req.user = await this.jwt.verifyAsync<JwtUser>(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }
    return true;
  }
}
