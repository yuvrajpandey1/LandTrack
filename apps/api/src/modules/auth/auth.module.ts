import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from '../../common/auth';
import { DatabaseModule } from '../../database/database.module';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [DatabaseModule, JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET, signOptions: { expiresIn: '15m' } })],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ],
  exports: [JwtModule, AuthService]
})
export class AuthModule {}
