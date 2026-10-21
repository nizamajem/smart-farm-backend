import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';
import { trim } from '../devices/dto';

export class LoginDto {
  @Transform(trim)
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}
