import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [DatabaseModule, NotificationsModule, AppointmentsModule],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
