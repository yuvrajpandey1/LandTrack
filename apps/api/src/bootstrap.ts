import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { validateEnvironment } from './config/env';
import { AppModule } from './app.module';

export async function createApiApplication() {
  validateEnvironment(process.env);
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.enableCors({
    origin: [process.env.APP_URL!],
    credentials: true
  });

  if (process.env.NODE_ENV !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('NRI Land Tracking System API')
      .setDescription('NRI Land Tracking System Hyderabad property registration API')
      .setVersion('1.3.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
  }

  return app;
}
