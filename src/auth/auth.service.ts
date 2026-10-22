import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ActivityService } from '../activity/activity.service';
import { ClientInfo } from '../activity/client-info.decorator';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto';
import { JwtUser } from './jwt-auth.guard';

const platformLabel = (p: string | null) => (p === 'android' ? 'aplikasi Android' : p === 'ios' ? 'aplikasi iOS' : 'website');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly activity: ActivityService,
  ) {}

  async login(dto: LoginDto, client: ClientInfo) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      if (user) {
        await this.activity.record(user.id, 'login_failed', {
          description: `Gagal login lewat ${platformLabel(client.platform)} (password salah)`,
          client,
        });
      }
      throw new UnauthorizedException('Email atau password salah');
    }
    await this.activity.record(user.id, 'login', { description: `Login lewat ${platformLabel(client.platform)}`, client });
    return this.issue(user);
  }

  async me(id: number) {
    const user = await this.users.findById(id);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private async issue(user: User) {
    const payload: JwtUser = { sub: user.id, email: user.email, name: user.name, role: user.role };
    const { passwordHash, ...safe } = user;
    return { accessToken: await this.jwt.signAsync(payload), user: safe };
  }
}
