import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required (set it in the gitignored .env)');
  }

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: ['http://127.0.0.1:4300', 'http://localhost:4300'],
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'x-correlation-id',
    ],
  });

  const port = Number(process.env.GATEWAY_PORT || process.env.PORT) || 3100;
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  if (process.env.NX_READY_SIGNAL_SOCKET) {
    try {
      const load = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
      (await load('@nx/js/ready-signal')).emitReadySignal(app.getHttpServer());
    } catch {
      // @nx/js isn't installed
    }
  }
  Logger.log(`api-gateway listening on http://${host}:${port}`);
}

bootstrap();
