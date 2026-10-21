import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtUser } from './jwt-auth.guard';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtUser => ctx.switchToHttp().getRequest().user,
);
