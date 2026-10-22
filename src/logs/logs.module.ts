import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';

/** Pencatat request (requestLogger) dipasang di main.ts sebagai middleware Express. */
@Module({
  controllers: [LogsController],
})
export class LogsModule {}
