import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsNumber, IsString, IsOptional, IsInt, MaxLength, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, JwtUser } from '../auth/jwt-auth.guard';
import { DevicesService } from './devices.service';
import { NutrientsService } from './nutrients.service';

export class RecipeDto {
  @IsOptional() @IsString() @MaxLength(80) crop?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3650) plantAgeDays?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(10000) targetTds?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(14) targetPh?: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Air utama harus berupa angka dalam liter' }) @Min(.01) @Max(1000000) waterLiters: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Larutan A harus berupa angka dalam ml' }) @Min(.001) @Max(1000000) aMl: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Larutan B harus berupa angka dalam ml' }) @Min(.001) @Max(1000000) bMl: number;
}
export class PumpCalibrationDto {
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber() @Min(.5) @Max(86400) seconds: number;
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber() @Min(.001) @Max(1000000) ml: number;
}
export class PlanDto {
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber({}, { message: 'Jumlah air harus berupa angka' }) @Min(.01, { message: 'Jumlah air minimal 0,01 liter' }) @Max(1000000) liters: number;
}
export class MixDto extends PlanDto {
  @IsOptional() @IsIn(['initial', 'correction']) mode?: 'initial' | 'correction';
  @IsBoolean() newWater: boolean;
  @IsString() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestId: string;
  @IsString() calibrationKey: string;
}

export class PhPlanDto {
  @IsIn(['phUp', 'phDown']) channel: 'phUp' | 'phDown';
  @Transform(({ value }) => typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : value)
  @IsNumber() @Min(.001) @Max(1000000) ml: number;
}
export class PhDoseDto extends PhPlanDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{8,100}$/) requestId: string;
  @IsString() calibrationKey: string;
}

@Controller('devices/:id/nutrients')
@UseGuards(JwtAuthGuard)
export class NutrientsController {
  constructor(private readonly devices: DevicesService, private readonly nutrients: NutrientsService) {}
  @Get()
  async status(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) { return this.nutrients.status(await this.devices.getOwned(user, id)); }
  @Post('ph/plan')
  async phPlan(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PhPlanDto) { return this.nutrients.phPlan(await this.devices.getOwned(user, id), dto.channel, dto.ml); }
  @Post('ph/dose')
  async phDose(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PhDoseDto) { await this.devices.getOwned(user, id); return this.nutrients.startPh(id, dto, user.sub); }
  @Post('ph/stop')
  async phStop(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) { await this.devices.getOwned(user, id); return this.nutrients.stopPh(id); }
  @Put('recipe')
  async recipe(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RecipeDto) { await this.devices.getOwned(user, id); return this.nutrients.saveRecipe(id, dto); }
  @Put('pumps/:channel')
  async pump(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Param('channel') channel: string, @Body() dto: PumpCalibrationDto) { await this.devices.getOwned(user, id); return this.nutrients.savePump(id, channel, dto); }
  @Post('pumps/:channel/import')
  async importPump(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Param('channel') channel: string, @Body() dto: PumpCalibrationDto) { await this.devices.getOwned(user, id); return this.nutrients.savePump(id, channel, dto, true); }
  @Post('plan')
  async plan(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: PlanDto) { return this.nutrients.plan(await this.devices.getOwned(user, id), dto.liters); }
  @Post('mix')
  async mix(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MixDto) { await this.devices.getOwned(user, id); return this.nutrients.start(id, dto, user.sub); }
  @Post('stop')
  async stop(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) { await this.devices.getOwned(user, id); return this.nutrients.stop(id); }
}
