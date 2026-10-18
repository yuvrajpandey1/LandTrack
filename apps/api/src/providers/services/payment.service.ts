import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PaymentOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId?: string;
  checkoutUrl?: string;
}

export interface ConfirmedPayment {
  paymentId: string;
  amount: number;
  currency: string;
}

export interface PaymentLink {
  id: string;
  reference_id: string;
  status: string;
  amount: number;
  amount_paid: number;
  currency: string;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
}

@Injectable()
export class PaymentService {
  async createOrder(amountInr: number, receipt: string): Promise<PaymentOrder> {
    if (!Number.isSafeInteger(amountInr) || amountInr < 1) throw new Error('Payment amount must be a positive integer in INR.');
    const amount = amountInr * 100;
    if (process.env.PAYMENT_PROVIDER === 'fake') {
      const orderId = `sandbox_${randomUUID()}`;
      return {
        orderId,
        amount,
        currency: 'INR',
        checkoutUrl: `${process.env.API_URL}/api/v1/dev/checkout/${orderId}`
      };
    }

    const result = await this.razorpayRequest('orders', {
      amount,
      currency: 'INR',
      receipt,
      notes: { description: 'NRI Land Tracking System property registration' }
    });
    if (
      typeof result.id !== 'string' || result.amount !== amount ||
      result.currency !== 'INR'
    ) {
      throw new Error('Payment provider order response did not match the requested amount and currency.');
    }
    return {
      orderId: result.id,
      amount: result.amount,
      currency: result.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    };
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): void {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error('Razorpay API secret is not configured.');
    const expected = createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new BadRequestException({ code: 'PAYMENT_SIGNATURE_INVALID', message: 'Payment signature verification failed.' });
    }
  }

  async confirmPayment(paymentId: string, orderId: string, expectedAmount: number, expectedCurrency: string): Promise<ConfirmedPayment> {
    let payment = await this.razorpayRequest(`payments/${encodeURIComponent(paymentId)}`);
    this.assertPaymentDetails(payment, paymentId, orderId, expectedAmount, expectedCurrency);
    if (payment.status === 'authorized') {
      payment = await this.razorpayRequest(`payments/${encodeURIComponent(paymentId)}/capture`, {
        amount: expectedAmount,
        currency: expectedCurrency
      });
    }
    this.assertPaymentDetails(payment, paymentId, orderId, expectedAmount, expectedCurrency);
    if (payment.status !== 'captured') {
      throw new BadRequestException({ code: 'PAYMENT_NOT_CAPTURED', message: 'Razorpay has not confirmed a captured payment.' });
    }
    return { paymentId, amount: expectedAmount, currency: expectedCurrency };
  }

  async fetchOrderPayments(orderId: string): Promise<OrderPayment[]> {
    const result = await this.razorpayRequest(`orders/${encodeURIComponent(orderId)}/payments`);
    if (!Array.isArray(result.items)) throw new Error('Payment provider order status response was incomplete.');
    return result.items.map((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Payment provider returned an invalid order payment.');
      }
      const payment = item as Record<string, unknown>;
      if (
        typeof payment.id !== 'string' || typeof payment.order_id !== 'string' ||
        typeof payment.amount !== 'number' || typeof payment.currency !== 'string' ||
        typeof payment.status !== 'string'
      ) {
        throw new Error('Payment provider returned an incomplete order payment.');
      }
      return {
        id: payment.id,
        orderId: payment.order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      };
    });
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): void {
    const secret = process.env.PAYMENT_PROVIDER === 'fake' ? process.env.JWT_REFRESH_SECRET! : process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Error('Razorpay webhook secret is not configured.');
    if (!signature) throw new UnauthorizedException({ code: 'PAYMENT_SIGNATURE_MISSING', message: 'Payment webhook signature is missing.' });
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'hex');
    } catch {
      throw new UnauthorizedException({ code: 'PAYMENT_SIGNATURE_INVALID', message: 'Payment webhook signature is invalid.' });
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException({ code: 'PAYMENT_SIGNATURE_INVALID', message: 'Payment webhook signature is invalid.' });
    }
  }

  signFakeWebhook(payload: object): { body: Buffer; signature: string } {
    const body = Buffer.from(JSON.stringify(payload));
    return {
      body,
      signature: createHmac('sha256', process.env.JWT_REFRESH_SECRET!).update(body).digest('hex')
    };
  }

  verifyPaymentLinkCallback(input: { paymentLinkId: string; referenceId: string; status: string; paymentId: string; signature: string }): void {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error('Razorpay API secret is not configured.');
    const expected = createHmac('sha256', secret)
      .update(`${input.paymentLinkId}|${input.referenceId}|${input.status}|${input.paymentId}`)
      .digest();
    const received = Buffer.from(input.signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new UnauthorizedException({ code: 'PAYMENT_SIGNATURE_INVALID', message: 'Payment callback signature is invalid.' });
    }
  }

  async fetchPaymentLink(paymentLinkId: string): Promise<PaymentLink> {
    const result = await this.razorpayRequest(`payment_links/${encodeURIComponent(paymentLinkId)}`);
    if (
      typeof result.id !== 'string' || typeof result.reference_id !== 'string' ||
      typeof result.status !== 'string' || typeof result.amount !== 'number' ||
      typeof result.amount_paid !== 'number' || typeof result.currency !== 'string'
    ) {
      throw new Error('Payment provider payment-link response was incomplete.');
    }
    return {
      id: result.id,
      reference_id: result.reference_id,
      status: result.status,
      amount: result.amount,
      amount_paid: result.amount_paid,
      currency: result.currency
    };
  }

  private async razorpayRequest(path: string, body?: object): Promise<Record<string, unknown>> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error('Razorpay credentials are not configured.');
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object' || Array.isArray(result)) {
      if (response.status === 401) {
        throw new UnauthorizedException({ code: 'PAYMENT_PROVIDER_AUTH_FAILED', message: 'Razorpay rejected the configured API credentials.' });
      }
      throw new Error(`Payment provider request failed (${response.status}).`);
    }
    return result as Record<string, unknown>;
  }

  private assertPaymentDetails(
    payment: Record<string, unknown>,
    paymentId: string,
    orderId: string,
    expectedAmount: number,
    expectedCurrency: string
  ): void {
    if (
      payment.id !== paymentId || payment.order_id !== orderId ||
      payment.amount !== expectedAmount || payment.currency !== expectedCurrency
    ) {
      throw new BadRequestException({ code: 'PAYMENT_DETAILS_MISMATCH', message: 'Payment does not match this order.' });
    }
  }
}
