import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import type { GatewayEnv } from './config/env';

async function bootstrap() {
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

  const config = app.get(ConfigService<GatewayEnv, true>);
  const port = config.get('GATEWAY_PORT', { infer: true });
  const host = config.get('HOST', { infer: true });
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
