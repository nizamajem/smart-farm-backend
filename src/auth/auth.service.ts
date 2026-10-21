import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './dto';
import { JwtUser } from './jwt-auth.guard';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (await this.users.findByEmailWithPassword(dto.email)) {
      throw new ConflictException('Email sudah terdaftar');
    }
    const user = await this.users.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, 10),
    });
    return this.issue(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email atau password salah');
    }
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
