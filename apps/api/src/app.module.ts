import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './common/audit.module';
import { ProvidersModule } from './providers/providers.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ChatModule } from './modules/chat/chat.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditDashboardModule } from './modules/audit/audit.module';

@Module({
  imports: [DatabaseModule, AuditModule, ProvidersModule, AuthModule, NotificationsModule, PropertiesModule, AppointmentsModule, ChatModule, AdminModule, AuditDashboardModule],
  controllers: [AppController, HealthController],
  providers: []
})
export class AppModule {}
