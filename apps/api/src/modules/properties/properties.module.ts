import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertyAdminController } from './property-admin.controller';
import { PropertiesService } from './properties.service';
import { PaymentController } from '../payments/payment.controller';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../../providers/providers.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule, NotificationsModule, ProvidersModule],
  controllers: [PropertiesController, PropertyAdminController, PaymentController],
  providers: [PropertiesService, PaymentsService],
  exports: [PropertiesService, PaymentsService]
})
export class PropertiesModule {}
