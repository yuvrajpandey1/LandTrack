import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AdminAppointmentsController } from './admin-appointments.controller';
import { AppointmentsService } from './appointments.service';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [DatabaseModule, NotificationsModule],
  controllers: [AppointmentsController, AdminAppointmentsController],
  providers: [AppointmentsService, GoogleCalendarService],
  exports: [AppointmentsService]
})
export class AppointmentsModule {}
