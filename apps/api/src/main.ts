import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validación y transformación de DTOs (class-validator + class-transformer)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Webhooks de Twilio llegan como application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false }));

  // Todos los endpoints bajo /api (ej. /api/health)
  app.setGlobalPrefix('api');

  // CORS: orígenes del frontend (ver .env)
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });

  // NOTA: algunas máquinas tienen PORT en el entorno del sistema; validar siempre.
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`API escuchando en http://localhost:${port}/api`);
}
bootstrap();
