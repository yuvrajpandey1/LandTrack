import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit.service';
import { StorageService } from '../../providers/services/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ChatGateway } from './chat.gateway';
import type { AuthUser } from '../../common/auth';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly gateway: ChatGateway,
    private readonly audit: AuditService
  ) {}

  async conversations(user: AuthUser) {
    const where = user.role === Role.ADMIN ? {} : { participants: { some: { userId: user.sub } } };
    const rows = await this.prisma.conversation.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: {
        property: { select: { id: true, name: true } },
        participants: { include: { user: { select: { id: true, name: true, role: true } } } },
        messages: { orderBy: { sentAt: 'desc' }, take: 1 }
      }
    });
    return rows.map((row) => {
      const membership = row.participants.find((participant) => participant.userId === user.sub);
      const lastRead = membership?.lastReadAt ?? row.createdAt;
      const unreadCount = row.messages.filter((message) => message.senderId !== user.sub && message.sentAt > lastRead).length;
      return { id: row.id, property: row.property, participants: row.participants.map(({ user: participant }) => participant), lastMessage: row.messages[0] ?? null, unreadCount };
    });
  }

  async messages(conversationId: string, cursor: string | undefined, user: AuthUser, readOnly = false) {
    await this.ensureParticipant(conversationId, user, readOnly);
    const messages = await this.prisma.message.findMany({
      where: { conversationId, hidden: false, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: { sender: { select: { id: true, name: true, role: true } }, attachment: { select: { id: true, mimeType: true, scanStatus: true } } }
    });
    if (readOnly) await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'TRANSCRIPT_VIEWED', entity: 'Conversation', entityId: conversationId });
    return { items: messages.reverse(), nextCursor: messages.length === 50 ? messages[messages.length - 1]?.id : null };
  }

  async presignAttachment(conversationId: string, user: AuthUser, mimeType: string, sizeBytes: number) {
    await this.ensureParticipant(conversationId, user);
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType) || sizeBytes < 1 || sizeBytes > 10 * 1024 * 1024) {
      throw new BadRequestException({ code: 'ATTACHMENT_INVALID', message: 'Attachments must be PDF, JPEG, or PNG files up to 10 MB.' });
    }
    const storageKey = `chat/${conversationId}/${this.storage.makeStorageKey(conversationId).split('/').at(-1)}`;
    const uploadUrl = await this.storage.createUpload(storageKey, mimeType, sizeBytes);
    const attachment = await this.prisma.chatAttachment.create({
      data: { conversationId, uploaderId: user.sub, storageKey, mimeType, sizeBytes }
    });
    return { attachmentId: attachment.id, uploadUrl, expiresInSeconds: 240 };
  }

  async completeAttachment(conversationId: string, attachmentId: string, user: AuthUser) {
    await this.ensureParticipant(conversationId, user);
    const attachment = await this.prisma.chatAttachment.findFirst({ where: { id: attachmentId, conversationId, uploaderId: user.sub } });
    if (!attachment) throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment was not found.' });
    const scan = await this.storage.scanObject(attachment.storageKey, attachment.mimeType, attachment.sizeBytes);
    await this.prisma.chatAttachment.update({ where: { id: attachment.id }, data: { scanStatus: 'CLEAN', sha256: scan.sha256 } });
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'CHAT_ATTACHMENT_SCANNED', entity: 'ChatAttachment', entityId: attachmentId });
    return { attachmentId, scanStatus: 'CLEAN' };
  }

  async sendMessage(conversationId: string, user: AuthUser, body: { text?: string; attachmentId?: string }) {
    await this.ensureParticipant(conversationId, user);
    const text = body.text?.trim();
    if (!text && !body.attachmentId) throw new BadRequestException({ code: 'MESSAGE_EMPTY', message: 'A message must include text or an attachment.' });
    if (text && text.length > 5000) throw new BadRequestException({ code: 'MESSAGE_TOO_LONG', message: 'Messages cannot exceed 5,000 characters.' });
    let attachment: { id: string; storageKey: string; mimeType: string } | undefined;
    if (body.attachmentId) {
      attachment = await this.prisma.chatAttachment.findFirst({ where: { id: body.attachmentId, conversationId, uploaderId: user.sub, scanStatus: 'CLEAN' }, select: { id: true, storageKey: true, mimeType: true } }) ?? undefined;
      if (!attachment) throw new BadRequestException({ code: 'ATTACHMENT_NOT_SCANNED', message: 'The attachment must pass scanning before it can be sent.' });
    }
    const message = await this.prisma.message.create({
      data: {
        conversationId, senderId: user.sub, channel: Channel.PORTAL, body: text,
        attachmentId: attachment?.id, attachmentKey: attachment?.storageKey, attachmentMime: attachment?.mimeType
      },
      include: { sender: { select: { id: true, name: true, role: true } }, attachment: { select: { id: true, mimeType: true, scanStatus: true } } }
    });
    this.gateway.broadcastMessage(conversationId, message);
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: user.sub } }, include: { user: { include: { consents: { where: { type: 'WHATSAPP', withdrawnAt: null } } } } }
    });
    for (const participant of participants) {
      if (this.gateway.isOnline(participant.userId)) continue;
      const recent = await this.prisma.notification.findFirst({
        where: { userId: participant.userId, template: `chat_alert:${conversationId}`, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }
      });
      if (recent) continue;
      await this.notifications.queueEmail(participant.user.email, 'New LandTrack message', `You have a new message in your LandTrack conversation${text ? `: ${text.slice(0, 300)}` : '.'}`, participant.userId);
      const whatsappConsent = participant.user.consents.length > 0;
      if (whatsappConsent && participant.user.whatsappNumber) {
        await this.notifications.queueWhatsApp(participant.userId, participant.user.whatsappNumber, 'new_message_alert', { preview: text?.slice(0, 80) ?? 'Attachment received' });
      }
    }
    return message;
  }

  async report(conversationId: string, messageId: string, user: AuthUser) {
    await this.ensureParticipant(conversationId, user);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message was not found.' });
    await this.prisma.message.update({ where: { id: messageId }, data: { reported: true } });
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'MESSAGE_REPORTED', entity: 'Message', entityId: messageId });
    return { status: 'reported' };
  }

  async attachmentUrl(conversationId: string, attachmentId: string, user: AuthUser) {
    await this.ensureParticipant(conversationId, user, user.role === Role.AUDITOR);
    const attachment = await this.prisma.chatAttachment.findFirst({ where: { id: attachmentId, conversationId, scanStatus: 'CLEAN' } });
    if (!attachment) throw new NotFoundException({ code: 'ATTACHMENT_NOT_AVAILABLE', message: 'The scanned attachment is not available.' });
    return { url: await this.storage.signDownload(attachment.storageKey), expiresInSeconds: 240 };
  }

  private async ensureParticipant(conversationId: string, user: AuthUser, readOnly = false): Promise<void> {
    const exists = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.sub } }
    });
    const conversation = exists ? true : await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!conversation) throw new NotFoundException({ code: 'CONVERSATION_NOT_FOUND', message: 'Conversation was not found.' });
    if (!exists && user.role !== Role.ADMIN && !(readOnly && user.role === Role.AUDITOR)) {
      throw new ForbiddenException({ code: 'CONVERSATION_ACCESS_DENIED', message: 'You are not a participant in this conversation.' });
    }
  }
}
