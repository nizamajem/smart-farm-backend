import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto';
import { Role, User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findAll() {
    return this.users.find({ order: { createdAt: 'ASC' } });
  }

  findById(id: number) {
    return this.users.findOne({ where: { id } });
  }

  findByEmailWithPassword(email: string) {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  count() {
    return this.users.count();
  }

  create(data: { name: string; email: string; passwordHash: string; role?: Role }) {
    return this.users.save(this.users.create({ ...data, email: data.email.toLowerCase() }));
  }

  async createAccount(dto: CreateUserDto) {
    if (await this.findByEmailWithPassword(dto.email)) {
      throw new ConflictException('Email sudah terdaftar');
    }
    const { passwordHash, ...safe } = await this.create({
      name: dto.name,
      email: dto.email,
      role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, 10),
    });
    return safe;
  }

  async remove(id: number, requesterId: number) {
    if (id === requesterId) throw new BadRequestException('Tidak bisa menghapus akun sendiri');
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Pengguna tidak ditemukan');
    await this.users.remove(user);
    return { ok: true };
  }
}
