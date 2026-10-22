import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { Client, ClientInfo } from '../activity/client-info.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CreateUserDto } from './dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Post()
  async create(@CurrentUser() admin: JwtUser, @Body() dto: CreateUserDto, @Client() client: ClientInfo) {
    const created = await this.users.createAccount(dto);
    await this.activity.action(admin.sub, 'user.create', `Membuat akun ${created.role} ${created.email}`, {
      client,
      meta: { userId: created.id },
    });
    return created;
  }

  @Delete(':id')
  async remove(@CurrentUser() admin: JwtUser, @Param('id', ParseIntPipe) id: number, @Client() client: ClientInfo) {
    const target = await this.users.findById(id);
    const result = await this.users.remove(id, admin.sub);
    await this.activity.action(admin.sub, 'user.delete', `Menghapus akun ${target?.email ?? `#${id}`}`, {
      client,
      meta: { userId: id },
    });
    return result;
  }
}
