import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

@Module({ controllers: [NotificationsController, WhatsAppWebhookController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
