import { Logger } from '@nestjs/common';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit,
  SubscribeMessage, WebSocketGateway, WebSocketServer, WsException
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, Role } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../../common/auth';

@WebSocketGateway({ namespace: '/chat', path: '/ws', cors: { origin: process.env.APP_URL, credentials: true } })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly online = new Map<string, number>();

  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async afterInit(server: Server): Promise<void> {
    const publisher = createClient({ url: process.env.REDIS_URL });
    const subscriber = publisher.duplicate();
    publisher.on('error', (error) => this.logger.error(`Socket Redis publisher error: ${error.message}`));
    subscriber.on('error', (error) => this.logger.error(`Socket Redis subscriber error: ${error.message}`));
    await Promise.all([publisher.connect(), subscriber.connect()]);
    server.adapter(createAdapter(publisher, subscriber));
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth.token as string | undefined
      ?? client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const user = await this.jwt.verifyAsync<AuthUser>(token);
      const active = await this.prisma.user.findFirst({ where: { id: user.sub, status: AccountStatus.ACTIVE }, select: { id: true } });
      if (!active) {
        client.disconnect(true);
        return;
      }
      client.data.user = user;
      this.online.set(user.sub, (this.online.get(user.sub) ?? 0) + 1);
      client.emit('presence', { userId: user.sub, online: true });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as AuthUser | undefined;
    if (!user) return;
    const connections = (this.online.get(user.sub) ?? 1) - 1;
    if (connections > 0) this.online.set(user.sub, connections);
    else {
      this.online.delete(user.sub);
      client.emit('presence', { userId: user.sub, online: false });
    }
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    const user = client.data.user as AuthUser | undefined;
    if (!user || !body?.conversationId) throw new WsException('Invalid conversation join request.');
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: body.conversationId, userId: user.sub } }
    });
    if (!participant && user.role !== Role.ADMIN) throw new WsException('You are not a participant in this conversation.');
    const conversation = await this.prisma.conversation.findUnique({ where: { id: body.conversationId }, select: { id: true } });
    if (!conversation) throw new WsException('Conversation was not found.');
    await client.join(this.room(conversation.id));
    return { conversationId: conversation.id, joined: true };
  }

  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string; active?: boolean }) {
    const user = client.data.user as AuthUser | undefined;
    if (!user || !body?.conversationId) return;
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: body.conversationId, userId: user.sub } }
    });
    if (!participant && user.role !== Role.ADMIN) return;
    client.to(this.room(body.conversationId)).emit('typing', { userId: user.sub, active: body.active === true });
  }

  @SubscribeMessage('message:read')
  async markRead(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    const user = client.data.user as AuthUser | undefined;
    if (!user || !body?.conversationId) return;
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: body.conversationId, userId: user.sub } }
    });
    if (!participant && user.role !== Role.ADMIN) return;
    await this.prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: body.conversationId, userId: user.sub } },
      create: { conversationId: body.conversationId, userId: user.sub, lastReadAt: new Date() },
      update: { lastReadAt: new Date() }
    });
    this.server.to(this.room(body.conversationId)).emit('message:read', { conversationId: body.conversationId, userId: user.sub, at: new Date().toISOString() });
  }

  broadcastMessage(conversationId: string, message: object): void {
    this.server.to(this.room(conversationId)).emit('message:new', message);
  }

  isOnline(userId: string): boolean {
    return this.online.has(userId);
  }

  private room(conversationId: string): string {
    return `conversation:${conversationId}`;
  }
}
