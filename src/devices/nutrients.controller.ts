import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsString, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { NutrientsService } from './nutrients.service';

export class RecipeDto {
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Liter acuan harus berupa angka' }) @Min(.01) @Max(1000000) liters: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Detik relay A harus berupa angka' }) @Min(.5) @Max(60) aSeconds: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Detik relay B harus berupa angka' }) @Min(.5) @Max(60) bSeconds: number;
}
export class PlanDto {
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Jumlah air harus berupa angka' }) @Min(.01, { message: 'Jumlah air minimal 0,01 liter' }) @Max(1000000) liters: number;
}
export class MixDto extends PlanDto {
  @IsBoolean() newWater: boolean;
  @IsString() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestId: string;
  @IsString() calibrationKey: string;
}

@Controller('devices/:id/nutrients')
@UseGuards(JwtAuthGuard)
export class NutrientsController {
  constructor(private readonly devices: DevicesService, private readonly nutrients: NutrientsService) {}
  @Get()
  async status(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) { return this.nutrients.status(await this.devices.getOwned(user, id)); }
  @Put('recipe')
  async recipe(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RecipeDto) { await this.devices.getOwned(user, id); return this.nutrients.saveRecipe(id, dto); }
  @Post('plan')
  async plan(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PlanDto) { return this.nutrients.plan(await this.devices.getOwned(user, id), dto.liters); }
  @Post('mix')
  async mix(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MixDto) { await this.devices.getOwned(user, id); return this.nutrients.start(id, dto, user.sub); }
  @Post('stop')
  async stop(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) { await this.devices.getOwned(user, id); return this.nutrients.stop(id); }
}
