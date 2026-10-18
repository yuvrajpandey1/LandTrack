import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Role, type Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { toJsonInput } from '../../common/json';
import { PrismaService } from '../../database/prisma.service';
import { PaymentService } from '../../providers/services/payment.service';
import { NotificationsService } from '../notifications/notifications.service';

type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: { user: true; property: true } }>;

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
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))::text`;
      const property = await transaction.property.findUnique({ where: { id: propertyId } });
      if (!property || property.ownerId !== userId) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
      const provider = process.env.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay_standard' : 'fake';
      const existing = await transaction.payment.findFirst({
        where: { propertyId, userId, provider, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING] } },
        orderBy: { createdAt: 'desc' }
      });
      if (existing) {
        return {
          paymentId: existing.id,
          orderId: existing.providerOrderId,
          keyId: provider === 'razorpay_standard' ? process.env.RAZORPAY_KEY_ID : undefined,
          checkoutUrl: existing.checkoutUrl,
          amount: Number(existing.amount) * 100,
          currency: existing.currency,
          provider: provider === 'fake' ? 'fake' : 'razorpay'
        };
      }
      const order = await this.provider.createOrder(amountInr, propertyId);
      const payment = await transaction.payment.create({
        data: {
          userId, propertyId, provider, providerOrderId: order.orderId,
          checkoutUrl: order.checkoutUrl, amount: amountInr, currency: 'INR'
        }
      });
      return {
        paymentId: payment.id,
        orderId: payment.providerOrderId,
        keyId: order.keyId,
        checkoutUrl: order.checkoutUrl,
        amount: order.amount,
        currency: order.currency,
        provider: provider === 'fake' ? 'fake' : 'razorpay'
      };
    }, { isolationLevel: 'Serializable' });
  }

  async verifyCheckoutPayment(userId: string, input: { orderId: string; paymentId: string; signature: string }) {
    if (process.env.PAYMENT_PROVIDER !== 'razorpay') {
      throw new NotFoundException({ code: 'PAYMENT_VERIFICATION_UNAVAILABLE', message: 'Razorpay payment verification is not enabled.' });
    }
    this.provider.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature);
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: input.orderId },
      include: { user: true, property: true }
    });
    if (!payment || payment.userId !== userId || payment.provider !== 'razorpay_standard') {
      throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      if (payment.providerPaymentId !== input.paymentId) {
        throw new BadRequestException({ code: 'PAYMENT_ALREADY_COMPLETE', message: 'This order has already been completed with a different payment.' });
      }
      return { status: PaymentStatus.SUCCESS, receiptNo: payment.receiptNo };
    }

    const confirmed = await this.provider.confirmPayment(
      input.paymentId,
      payment.providerOrderId,
      Number(payment.amount) * 100,
      payment.currency
    );
    const processed = await this.markPaymentSuccessful(payment, confirmed.paymentId, {
      source: 'razorpay_standard_checkout',
      orderId: input.orderId,
      paymentId: confirmed.paymentId,
      amount: confirmed.amount,
      currency: confirmed.currency
    });
    if (!processed) {
      const current = await this.prisma.payment.findUnique({ where: { id: payment.id } });
      if (current?.status !== PaymentStatus.SUCCESS || current.providerPaymentId !== input.paymentId) {
        throw new BadRequestException({ code: 'PAYMENT_NOT_CONFIRMED', message: 'Payment could not be confirmed. Please refresh and check payment history.' });
      }
    }
    return {
      status: PaymentStatus.SUCCESS,
      receiptNo: payment.receiptNo ?? `LT-${payment.id.slice(0, 8).toUpperCase()}`
    };
  }

  async confirmCheckoutOrder(userId: string, orderId: string) {
    if (process.env.PAYMENT_PROVIDER !== 'razorpay') {
      throw new NotFoundException({ code: 'PAYMENT_VERIFICATION_UNAVAILABLE', message: 'Razorpay payment verification is not enabled.' });
    }
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: orderId },
      include: { user: true, property: true }
    });
    if (!payment || payment.userId !== userId || payment.provider !== 'razorpay_standard') {
      throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      return {
        status: PaymentStatus.SUCCESS,
        receiptNo: payment.receiptNo ?? `LT-${payment.id.slice(0, 8).toUpperCase()}`
      };
    }

    const providerPayments = await this.provider.fetchOrderPayments(payment.providerOrderId);
    const matchingPayments = providerPayments.filter((item) =>
      item.orderId === payment.providerOrderId &&
      item.amount === Number(payment.amount) * 100 &&
      item.currency === payment.currency
    );
    const confirmedPayment = matchingPayments.find((item) => item.status === 'captured')
      ?? matchingPayments.find((item) => item.status === 'authorized');
    if (!confirmedPayment) return { status: PaymentStatus.PENDING };

    const confirmed = await this.provider.confirmPayment(
      confirmedPayment.id,
      payment.providerOrderId,
      Number(payment.amount) * 100,
      payment.currency
    );
    const processed = await this.markPaymentSuccessful(payment, confirmed.paymentId, {
      source: 'razorpay_checkout_dismissal',
      orderId: payment.providerOrderId,
      paymentId: confirmed.paymentId,
      amount: confirmed.amount,
      currency: confirmed.currency
    });
    if (!processed) {
      const current = await this.prisma.payment.findUnique({ where: { id: payment.id } });
      if (current?.status !== PaymentStatus.SUCCESS || current.providerPaymentId !== confirmed.paymentId) {
        throw new BadRequestException({ code: 'PAYMENT_NOT_CONFIRMED', message: 'Payment could not be confirmed. Please check payment history.' });
      }
    }
    return {
      status: PaymentStatus.SUCCESS,
      receiptNo: payment.receiptNo ?? `LT-${payment.id.slice(0, 8).toUpperCase()}`
    };
  }

  async confirmDemoCheckoutExit(userId: string, orderId: string) {
    if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_PROVIDER !== 'fake') {
      throw new NotFoundException({ code: 'DEMO_CHECKOUT_UNAVAILABLE', message: 'Demo checkout confirmation is only available in local development.' });
    }
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: orderId },
      include: { user: true, property: true }
    });
    if (!payment || payment.userId !== userId || payment.provider !== 'fake') {
      throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Demo payment order was not found.' });
    }
    if (payment.status !== PaymentStatus.SUCCESS) await this.simulatePayment(orderId);
    const confirmed = await this.prisma.payment.findUnique({ where: { id: payment.id } });
    if (confirmed?.status !== PaymentStatus.SUCCESS) {
      throw new BadRequestException({ code: 'DEMO_PAYMENT_NOT_CONFIRMED', message: 'Demo payment could not be completed. Please retry.' });
    }
    return {
      status: PaymentStatus.SUCCESS,
      receiptNo: confirmed.receiptNo ?? `LT-${confirmed.id.slice(0, 8).toUpperCase()}`,
      propertyId: confirmed.propertyId,
      demo: true
    };
  }

  async verifyPaymentLink(userId: string, input: {
    paymentLinkId: string;
    referenceId: string;
    status: string;
    paymentId: string;
    signature: string;
  }) {
    if (process.env.PAYMENT_PROVIDER !== 'razorpay') {
      throw new NotFoundException({ code: 'PAYMENT_VERIFICATION_UNAVAILABLE', message: 'Razorpay payment verification is not enabled.' });
    }
    this.provider.verifyPaymentLinkCallback(input);
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: input.paymentLinkId },
      include: { user: true, property: true }
    });
    if (!payment || payment.userId !== userId || payment.propertyId !== input.referenceId || payment.provider !== 'razorpay') {
      throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    }
    const link = await this.provider.fetchPaymentLink(input.paymentLinkId);
    if (
      link.id !== payment.providerOrderId ||
      link.reference_id !== payment.propertyId ||
      link.status.toLowerCase() !== 'paid' ||
      link.amount_paid !== Number(payment.amount) * 100 ||
      link.amount !== Number(payment.amount) * 100 ||
      link.currency !== payment.currency ||
      input.status.toLowerCase() !== 'paid'
    ) {
      throw new BadRequestException({ code: 'PAYMENT_NOT_CONFIRMED', message: 'Razorpay has not confirmed this payment.' });
    }
    await this.markPaymentSuccessful(payment, input.paymentId, { source: 'razorpay_callback', paymentLinkId: link.id });
    return {
      status: PaymentStatus.SUCCESS,
      receiptNo: payment.receiptNo ?? `LT-${payment.id.slice(0, 8).toUpperCase()}`
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined, payload: unknown): Promise<{ status: string }> {
    this.provider.verifyWebhook(rawBody, signature);
    if (!payload || typeof payload !== 'object') throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Payment event payload is invalid.' });
    const body = payload as Record<string, unknown>;
    const event = String(body.event ?? '');
    if (process.env.PAYMENT_PROVIDER === 'fake' && event !== 'payment.captured') {
      throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Unexpected sandbox payment event.' });
    }
    if (process.env.PAYMENT_PROVIDER === 'razorpay' && event !== 'payment_link.paid' && event !== 'payment.captured' && event !== 'order.paid') return { status: 'ignored' };
    const entity = this.paymentEntity(body);
    if (!entity.orderId || entity.amount === undefined || !Number.isFinite(entity.amount)) {
      throw new BadRequestException({ code: 'PAYMENT_EVENT_INVALID', message: 'Payment event is missing its order, payment ID, or amount.' });
    }
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: entity.orderId }, include: { user: true, property: true } });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_ORDER_NOT_FOUND', message: 'Payment order was not found.' });
    const expectedProvider = event === 'payment_link.paid' ? 'razorpay' : process.env.PAYMENT_PROVIDER === 'fake' ? 'fake' : 'razorpay_standard';
    if (payment.provider !== expectedProvider) {
      throw new BadRequestException({ code: 'PAYMENT_PROVIDER_MISMATCH', message: "Payment event does not match this order's provider." });
    }
    if (Number(payment.amount) * 100 !== entity.amount || (entity.currency && entity.currency !== payment.currency)) {
      throw new BadRequestException({ code: 'PAYMENT_AMOUNT_MISMATCH', message: 'Payment amount or currency does not match the registered order.' });
    }
    const processed = await this.markPaymentSuccessful(payment, entity.paymentId, body);
    if (!processed) return { status: 'already_processed' };
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

  private async markPaymentSuccessful(payment: PaymentWithRelations, providerPaymentId: string | undefined, confirmation: object): Promise<boolean> {
    const receiptNo = payment.receiptNo ?? `LT-${payment.id.slice(0, 8).toUpperCase()}`;
    const processed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.payment.updateMany({
        where: { id: payment.id, status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.FAILED] } },
        data: {
          status: PaymentStatus.SUCCESS,
          ...(providerPaymentId ? { providerPaymentId } : {}),
          receiptNo,
          paidAt: new Date(),
          rawWebhook: toJsonInput(confirmation)
        }
      });
      if (updated.count === 0) return false;
      await transaction.property.updateMany({
        where: { id: payment.propertyId, status: 'PAYMENT_PENDING' },
        data: { status: 'SUBMITTED', submittedAt: new Date() }
      });
      return true;
    });
    if (!processed) return false;
    await this.audit.record({
      actorId: payment.userId,
      actorRole: payment.user.role,
      action: 'PAYMENT_SUCCEEDED',
      entity: 'Payment',
      entityId: payment.id,
      after: { status: PaymentStatus.SUCCESS, providerPaymentId }
    });
    await this.notifications.queueEmail(
      payment.user.email,
      'NRI Land Tracking System registration payment received',
      `We received your INR ${payment.amount.toString()} property registration payment for ${payment.property.name}. Receipt: ${receiptNo}.`,
      payment.userId
    );
    if (payment.user.whatsappNumber) {
      await this.notifications.queueWhatsApp(payment.userId, payment.user.whatsappNumber, 'payment_receipt', { propertyName: payment.property.name, amount: String(payment.amount) });
    }
    return true;
  }
}
