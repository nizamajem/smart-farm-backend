import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

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
}
