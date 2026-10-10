import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PaymentOrder {
  orderId: string;
  checkoutUrl: string;
}

@Injectable()
export class PaymentService {
  async createOrder(amountInr: number, receipt: string): Promise<PaymentOrder> {
    if (!Number.isSafeInteger(amountInr) || amountInr < 1) throw new Error('Payment amount must be a positive integer in INR.');
    if (process.env.PAYMENT_PROVIDER === 'fake') {
      const orderId = `sandbox_${randomUUID()}`;
      return { orderId, checkoutUrl: `${process.env.API_URL}/api/v1/dev/checkout/${orderId}` };
    }
    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        amount: amountInr * 100,
        currency: 'INR',
        reference_id: receipt,
        description: 'LandTrack property registration',
        accept_partial: false,
        reminder_enable: false,
        notify: { sms: false, email: false },
        callback_url: `${process.env.APP_URL}/app/payments`,
        callback_method: 'get',
        expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60
      })
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object' || !('id' in result) || !('short_url' in result)) {
      throw new Error(`Payment provider hosted checkout creation failed (${response.status}).`);
    }
    const paymentLink = result as { id: string; short_url: string };
    return {
      orderId: paymentLink.id,
      checkoutUrl: paymentLink.short_url
    };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): void {
    const secret = process.env.PAYMENT_PROVIDER === 'fake' ? process.env.JWT_REFRESH_SECRET! : process.env.RAZORPAY_WEBHOOK_SECRET!;
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
}
