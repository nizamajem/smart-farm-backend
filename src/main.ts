import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HubLogger, logHub } from './logs/log-hub';
import { requestLogger } from './logs/request-logger.middleware';

// Error yang lolos dari Nest tetap tercatat di Logs → Umum
process.on('unhandledRejection', (reason) => {
  logHub.push('system', 'error', 'Process', `Unhandled rejection: ${String((reason as Error)?.message ?? reason)}`, (reason as Error)?.stack);
  console.error('Unhandled rejection', reason);
});
process.on('uncaughtException', (err) => {
  logHub.push('system', 'error', 'Process', `Uncaught exception: ${err.message}`, err.stack);
  console.error('Uncaught exception', err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new HubLogger() });
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true });
  app.use(requestLogger);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  logHub.push('system', 'info', 'App', `Smart Farm API berjalan di port ${port}`);
  console.log(`Smart Farm API berjalan di http://localhost:${port}/api`);
}
bootstrap();
