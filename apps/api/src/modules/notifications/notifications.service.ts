import { BadRequestException, ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Channel, Role } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../../providers/services/email.service';
import { WhatsAppService } from '../../providers/services/whatsapp.service';
import { AuditService } from '../../common/audit.service';

interface DeliveryJob {
  notificationId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  payload: { to: string; subject?: string; text?: string; template?: string; variables?: Record<string, string> };
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue<DeliveryJob>;
  private worker?: Worker<DeliveryJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: EmailService,
    private readonly whatsappProvider: WhatsAppService,
    private readonly audit: AuditService
  ) {
    const redis = new URL(process.env.REDIS_URL!);
    this.queue = new Queue<DeliveryJob>('landtrack-notifications', {
      connection: { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined, maxRetriesPerRequest: null }
    });
  }

  async onModuleInit(): Promise<void> {
    const redis = new URL(process.env.REDIS_URL!);
    this.worker = new Worker<DeliveryJob>(
      'landtrack-notifications',
      async (job: Job<DeliveryJob>) => {
        const { notificationId, channel, payload } = job.data;
        try {
          if (channel === 'EMAIL') {
            if (!payload.subject || !payload.text) throw new Error('Email notification payload is missing a subject or body.');
            await this.mailer.send(payload.to, payload.subject, payload.text);
          } else {
            if (!payload.template) throw new Error('WhatsApp notification payload is missing its template.');
            const externalId = await this.whatsappProvider.sendTemplate(payload.to, payload.template, payload.variables ?? {});
            await this.prisma.notification.update({ where: { id: notificationId }, data: { externalId } });
          }
          await this.prisma.notification.update({ where: { id: notificationId }, data: { status: 'SENT', error: null } });
        } catch (error) {
          if (job.attemptsMade >= 4) {
            await this.prisma.notification.update({
              where: { id: notificationId },
              data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'Provider delivery failed.' }
            });
          }
          throw error;
        }
      },
      { connection: { host: redis.hostname, port: Number(redis.port || 6379), password: redis.password || undefined, maxRetriesPerRequest: null }, concurrency: 5 }
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.worker?.close(), this.queue.close()]);
  }

  async queueEmail(to: string, subject: string, text: string, userId?: string): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: { userId, channel: Channel.EMAIL, template: subject, payload: { to, subject, text }, status: 'QUEUED' }
    });
    await this.queue.add('deliver', { notificationId: notification.id, channel: 'EMAIL', payload: { to, subject, text } }, {
      jobId: notification.id, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000
    });
  }

  async queueWhatsApp(userId: string, to: string, template: string, variables: Record<string, string>): Promise<void> {
    const consent = await this.prisma.consent.findFirst({ where: { userId, type: 'WHATSAPP', withdrawnAt: null } });
    if (!consent) return;
    const notification = await this.prisma.notification.create({
      data: { userId, channel: Channel.WHATSAPP, template, payload: variables, status: 'QUEUED' }
    });
    await this.queue.add('deliver', {
      notificationId: notification.id, channel: 'WHATSAPP', payload: { to, template, variables }
    }, {
      jobId: notification.id, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000
    });
  }

  verifyWhatsAppWebhook(mode: string | undefined, token: string | undefined, challenge: string | undefined): string {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN!;
    const supplied = Buffer.from(token ?? '');
    const expected = Buffer.from(expectedToken);
    if (mode !== 'subscribe' || !challenge || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException({ code: 'WHATSAPP_VERIFICATION_FAILED', message: 'WhatsApp webhook verification failed.' });
    }
    return challenge;
  }

  async handleWhatsAppWebhook(rawBody: Buffer, signature: string | undefined, payload: unknown): Promise<{ status: string }> {
    const secret = process.env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_VERIFY_TOKEN!;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const actual = Buffer.from(signature ?? '');
    const expectedBytes = Buffer.from(expected);
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
      throw new UnauthorizedException({ code: 'WHATSAPP_SIGNATURE_INVALID', message: 'WhatsApp webhook signature is invalid.' });
    }
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException({ code: 'WHATSAPP_EVENT_INVALID', message: 'WhatsApp event payload is invalid.' });
    }

    const root = payload as Record<string, unknown>;
    const entries = Array.isArray(root.entry) ? root.entry : [];
    for (const entryValue of entries) {
      if (!entryValue || typeof entryValue !== 'object') continue;
      const changes = (entryValue as Record<string, unknown>).changes;
      if (!Array.isArray(changes)) continue;
      for (const changeValue of changes) {
        if (!changeValue || typeof changeValue !== 'object') continue;
        const value = (changeValue as Record<string, unknown>).value;
        if (!value || typeof value !== 'object') continue;
        const data = value as Record<string, unknown>;
        if (Array.isArray(data.statuses)) {
          for (const statusValue of data.statuses) {
            if (!statusValue || typeof statusValue !== 'object') continue;
            const status = statusValue as Record<string, unknown>;
            if (typeof status.id !== 'string' || typeof status.status !== 'string') continue;
            await Promise.all([
              this.prisma.notification.updateMany({ where: { externalId: status.id }, data: { status: status.status.toUpperCase() } }),
              this.prisma.message.updateMany({ where: { externalId: status.id }, data: { deliveryStatus: status.status } })
            ]);
          }
        }
        if (Array.isArray(data.messages)) {
          for (const messageValue of data.messages) {
            if (!messageValue || typeof messageValue !== 'object') continue;
            const message = messageValue as Record<string, unknown>;
            if (typeof message.id !== 'string' || typeof message.from !== 'string') continue;
            const textBody = message.type === 'text' && message.text && typeof message.text === 'object'
              ? (message.text as Record<string, unknown>).body
              : undefined;
            const body = typeof textBody === 'string' && textBody.trim()
              ? textBody.trim()
              : typeof message.type === 'string' ? `[${message.type} message received]` : undefined;
            if (!body) continue;
            await this.captureWhatsAppReply(message.id, `+${message.from}`, body);
          }
        }
      }
    }
    return { status: 'received' };
  }

  private async captureWhatsAppReply(externalId: string, from: string, body: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ mobile: from }, { whatsappNumber: from }] },
      select: { id: true, role: true, status: true }
    });
    if (!user || await this.prisma.message.findFirst({ where: { externalId }, select: { id: true } })) return;
    if (/^(stop|unsubscribe|cancel|end|quit)$/i.test(body)) {
      await this.prisma.consent.updateMany({
        where: { userId: user.id, type: 'WHATSAPP', withdrawnAt: null },
        data: { withdrawnAt: new Date() }
      });
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: { participants: { some: { userId: user.id } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    });
    if (!conversation) {
      await this.audit.record({
        actorId: user.id, actorRole: user.role, action: 'WHATSAPP_MESSAGE_UNLINKED',
        entity: 'WhatsAppMessage', entityId: externalId, after: { reason: 'No conversation exists for this user.' }
      });
      return;
    }
    const recorded = await this.prisma.message.create({
      data: {
        conversationId: conversation.id, senderId: user.id, channel: Channel.WHATSAPP,
        body, externalId, deliveryStatus: 'received'
      }
    });
    await this.audit.record({
      actorId: user.id, actorRole: user.role, action: 'WHATSAPP_MESSAGE_RECEIVED',
      entity: 'Message', entityId: recorded.id, after: { externalId }
    });
  }

  async list(userId: string, role: Role): Promise<object[]> {
    if (role !== Role.ADMIN) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only administrators can view delivery logs.' });
    return this.prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, userId: true, channel: true, template: true, status: true, error: true, createdAt: true } });
  }
}
