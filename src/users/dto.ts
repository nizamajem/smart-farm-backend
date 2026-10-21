import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import { Role } from './user.entity';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn(['admin', 'user'])
  role: Role;
}
