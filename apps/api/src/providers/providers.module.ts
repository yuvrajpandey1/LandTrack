import { Global, Module } from '@nestjs/common';
import { EmailService } from './services/email.service';
import { PaymentService } from './services/payment.service';
import { StorageService } from './services/storage.service';
import { WhatsAppService } from './services/whatsapp.service';

@Global()
@Module({
  providers: [EmailService, PaymentService, StorageService, WhatsAppService],
  exports: [EmailService, PaymentService, StorageService, WhatsAppService]
})
export class ProvidersModule {}
