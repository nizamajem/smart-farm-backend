import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Client, ClientInfo } from '../activity/client-info.decorator';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto';
import { JwtAuthGuard, JwtUser } from './jwt-auth.guard';

/** Tidak ada pendaftaran publik: akun dibuat admin lewat /users. */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Client() client: ClientInfo) {
    return this.auth.login(dto, client);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }
}
