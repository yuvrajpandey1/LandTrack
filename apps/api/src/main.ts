import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { validateEnvironment } from './config/env';
import { AppModule } from './app.module';

async function bootstrap() {
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

  const origin = process.env.APP_URL!;
  app.enableCors({
    origin: [origin],
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

  await app.listen(Number(process.env.PORT ?? 4000));
  console.info(`NRI Land Tracking System API is listening on port ${Number(process.env.PORT ?? 4000)}.`);
}

void bootstrap();
