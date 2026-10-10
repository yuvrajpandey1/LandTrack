import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProvidersModule } from '../../providers/providers.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NotificationsModule, ProvidersModule, AuthModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway]
})
export class ChatModule {}
