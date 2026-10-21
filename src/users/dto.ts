import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { trim } from '../devices/dto';
import { Role } from './user.entity';

export class CreateUserDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  name: string;

  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn(['admin', 'user'])
  role: Role;
}
