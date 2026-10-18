import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Role } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { toJsonInput } from '../../common/json';
import { PrismaService } from '../../database/prisma.service';
import { PaymentService } from '../../providers/services/payment.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService
  ) {}

  async createOrder(propertyId: string, userId: string): Promise<object> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'registrationChargeInr' } });
    const amountInr = setting ? Number(setting.value) : 500;
    if (!Number.isSafeInteger(amountInr) || amountInr < 1 || amountInr > 100_000) {
      throw new Error('The configured registration charge is invalid.');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`;
      const property = await transaction.property.findUnique({ where: { id: propertyId } });
      if (!property || property.ownerId !== userId) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
      const existing = await transaction.payment.findFirst({
        where: { propertyId, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
        orderBy: { createdAt: 'desc' }
      });
      if (existing) return { paymentId: existing.id, orderId: existing.providerOrderId, checkoutUrl: existing.checkoutUrl, amount: amountInr, currency: 'INR' };
      const order = await this.provider.createOrder(amountInr, propertyId);
      const payment = await transaction.payment.create({
        data: {
          userId, propertyId, provider: process.env.PAYMENT_PROVIDER!, providerOrderId: order.orderId,
          checkoutUrl: order.checkoutUrl, amount: amountInr, currency: 'INR'
        }
      });
      return { paymentId: payment.id, orderId: payment.providerOrderId, checkoutUrl: payment.checkoutUrl, amount: amountInr, currency: 'INR' };
    }, { isolationLevel: 'Serializable' });
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined, payload: unknown): Promise<{ status: string }> {
    this.provider.verifyWebhook(rawBody, signature);
    if (!payload || typeof payload !== 'object') throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Payment event payload is invalid.' });
    const body = payload as Record<string, unknown>;
    const event = String(body.event ?? '');
    if (process.env.PAYMENT_PROVIDER === 'fake' && event !== 'payment.captured') {
      throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Unexpected sandbox payment event.' });
    }
    if (process.env.PAYMENT_PROVIDER === 'razorpay' && event !== 'payment_link.paid') return { status: 'ignored' };
    const entity = this.paymentEntity(body);
    if (!entity.orderId || entity.amount === undefined) {
      throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Payment event is missing its order, payment ID, or amount.' });
    }
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: entity.orderId }, include: { user: true, property: true } });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    if (Number(payment.amount) * 100 !== entity.amount || (entity.currency && entity.currency !== payment.currency)) {
      throw new BadRequestException({ code: 'PAYMENT_AMOUNT_MISMATCH', message: 'Payment amount or currency does not match the registered order.' });
    }
    const processed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.payment.updateMany({
        where: { id: payment.id, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.FAILED] } },
        data: {
          status: PaymentStatus.SUCCESS, ...(entity.paymentId ? { providerPaymentId: entity.paymentId } : {}),
          receiptNo: `LT-${payment.id.slice(0, 8).toUpperCase()}`, paidAt: new Date(),
          rawWebhook: toJsonInput(body)
        }
      });
      if (updated.count === 0) return false;
      await transaction.property.updateMany({
        where: { id: payment.propertyId, status: 'PAYMENT_PENDING' },
        data: { status: 'SUBMITTED', submittedAt: new Date() }
      });
      return true;
    });
    if (!processed) return { status: 'already_processed' };
    await this.audit.record({
      action: 'PAYMENT_SUCCEEDED', entity: 'Payment', entityId: payment.id,
      after: { status: PaymentStatus.SUCCESS, providerPaymentId: entity.paymentId }
    });
    await this.notifications.queueEmail(payment.user.email, 'NRI Land Tracking System registration payment received', `We received your INR ${payment.amount.toString()} property registration payment for ${payment.property.name}. Receipt: LT-${payment.id.slice(0, 8).toUpperCase()}.`, payment.userId);
    if (payment.user.whatsappNumber) {
      await this.notifications.queueWhatsApp(payment.userId, payment.user.whatsappNumber, 'payment_receipt', { propertyName: payment.property.name, amount: String(payment.amount) });
    }
    return { status: 'processed' };
  }

  async simulatePayment(orderId: string): Promise<{ status: string }> {
    if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_PROVIDER !== 'fake') {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'The sandbox checkout is disabled.' });
    }
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    const payload = {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: orderId, id: `sandbox_payment_${payment.id}`, amount: Number(payment.amount) * 100, currency: payment.currency } } }
    };
    const signed = this.provider.signFakeWebhook(payload);
    return this.handleWebhook(signed.body, signed.signature, payload);
  }

  async list(userId: string, role: Role) {
    return this.prisma.payment.findMany({
      where: role === Role.ADMIN ? {} : { userId },
      orderBy: { createdAt: 'desc' },
      include: { property: { select: { id: true, name: true } } }
    });
  }

  async receipt(id: string, userId: string, role: Role) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { property: true, user: { select: { id: true, name: true, email: true } } }
    });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found.' });
    if (role !== Role.ADMIN && payment.userId !== userId) throw new ForbiddenException({ code: 'PAYMENT_ACCESS_DENIED', message: 'You cannot access this receipt.' });
    if (payment.status !== PaymentStatus.SUCCESS) throw new BadRequestException({ code: 'PAYMENT_NOT_COMPLETE', message: 'A receipt is available after payment succeeds.' });
    return {
      receiptNo: payment.receiptNo,
      paidAt: payment.paidAt,
      amount: payment.amount.toString(),
      currency: payment.currency,
      payer: payment.user.name,
      property: payment.property.name,
      propertyId: payment.propertyId
    };
  }

  private paymentEntity(payload: Record<string, unknown>): { orderId?: string; paymentId?: string; amount?: number; currency?: string } {
    if (payload.event === 'payment_link.paid') {
      const container = payload.payload;
      if (!container || typeof container !== 'object') return {};
      const root = container as Record<string, unknown>;
      const linkContainer = root.payment_link;
      if (!linkContainer || typeof linkContainer !== 'object') return {};
      const linkEntity = (linkContainer as Record<string, unknown>).entity;
      if (!linkEntity || typeof linkEntity !== 'object') return {};
      const link = linkEntity as Record<string, unknown>;
      const paymentContainer = root.payment;
      const paymentEntity = paymentContainer && typeof paymentContainer === 'object'
        ? (paymentContainer as Record<string, unknown>).entity
        : undefined;
      const payment = paymentEntity && typeof paymentEntity === 'object' ? paymentEntity as Record<string, unknown> : undefined;
      const amount = typeof link.amount_paid === 'number' ? link.amount_paid : undefined;
      return {
        orderId: typeof link.id === 'string' ? link.id : undefined,
        paymentId: typeof payment?.id === 'string' ? payment.id : undefined,
        amount,
        currency: typeof link.currency === 'string' ? link.currency : undefined
      };
    }
    if (payload.event === 'payment.captured' || payload.event === 'order.paid') {
      const payloadContainer = payload.payload;
      if (payloadContainer && typeof payloadContainer === 'object') {
        const paymentContainer = (payloadContainer as Record<string, unknown>).payment;
        if (paymentContainer && typeof paymentContainer === 'object') {
          const entity = (paymentContainer as Record<string, unknown>).entity;
          if (entity && typeof entity === 'object') {
            const data = entity as Record<string, unknown>;
            return {
              orderId: String(data.order_id ?? ''),
              paymentId: String(data.id ?? ''),
              amount: Number(data.amount),
              currency: typeof data.currency === 'string' ? data.currency : undefined
            };
          }
        }
      }
    }
    return {};
  }
}
