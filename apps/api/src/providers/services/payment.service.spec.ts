/// <reference types="jest" />
import { createHmac } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  const originalEnvironment = {
    APP_URL: process.env.APP_URL,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
    RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET
  };
  const service = new PaymentService();

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('creates a Standard Checkout order with the configured API credentials', async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'order_test_123',
      amount: 50000,
      currency: 'INR'
    }), { status: 200 }));

    await expect(service.createOrder(500, 'property-id')).resolves.toEqual({
      orderId: 'order_test_123',
      amount: 50000,
      currency: 'INR',
      keyId: 'rzp_test_key'
    });
    expect(fetch).toHaveBeenCalledWith('https://api.razorpay.com/v1/orders', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from('rzp_test_key:api-secret').toString('base64')}`
      }),
      body: expect.stringContaining('"receipt":"property-id"')
    }));
  });

  it('creates a Standard Checkout signature and rejects a changed payment ID', () => {
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    const signature = createHmac('sha256', 'api-secret').update('order_test_123|pay_test_123').digest('hex');

    expect(() => service.verifyCheckoutSignature('order_test_123', 'pay_test_123', signature)).not.toThrow();
    expect(() => service.verifyCheckoutSignature('order_test_123', 'pay_other', signature)).toThrow();
  });

  it('verifies the Razorpay payment-link callback signature', () => {
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    const input = {
      paymentLinkId: 'plink_test_123',
      referenceId: 'property-id',
      status: 'paid',
      paymentId: 'pay_test_123',
      signature: ''
    };
    input.signature = createHmac('sha256', 'api-secret')
      .update(`${input.paymentLinkId}|${input.referenceId}|${input.status}|${input.paymentId}`)
      .digest('hex');

    expect(() => service.verifyPaymentLinkCallback(input)).not.toThrow();
    expect(() => service.verifyPaymentLinkCallback({ ...input, signature: 'invalid' })).toThrow(UnauthorizedException);
  });

  it('verifies Razorpay webhooks with the separate webhook secret', () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
    const body = Buffer.from('{"event":"payment_link.paid"}');
    const signature = createHmac('sha256', 'webhook-secret').update(body).digest('hex');

    expect(() => service.verifyWebhook(body, signature)).not.toThrow();
    expect(() => service.verifyWebhook(body, '00'.repeat(32))).toThrow(UnauthorizedException);
  });

  it('fetches and validates a payment link from Razorpay before accepting callback data', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'plink_test_123',
      reference_id: 'property-id',
      status: 'paid',
      amount: 50000,
      amount_paid: 50000,
      currency: 'INR'
    }), { status: 200 }));

    await expect(service.fetchPaymentLink('plink_test_123')).resolves.toEqual({
      id: 'plink_test_123',
      reference_id: 'property-id',
      status: 'paid',
      amount: 50000,
      amount_paid: 50000,
      currency: 'INR'
    });
  });

  it('confirms a captured Standard Checkout payment belongs to its order and amount', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'pay_test_123',
      order_id: 'order_test_123',
      amount: 50000,
      currency: 'INR',
      status: 'captured'
    }), { status: 200 }));

    await expect(service.confirmPayment('pay_test_123', 'order_test_123', 50000, 'INR')).resolves.toEqual({
      paymentId: 'pay_test_123',
      amount: 50000,
      currency: 'INR'
    });
  });

  it('captures an authorized Standard Checkout payment before confirming it', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    const fetch = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'pay_test_123',
        order_id: 'order_test_123',
        amount: 50000,
        currency: 'INR',
        status: 'authorized'
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'pay_test_123',
        order_id: 'order_test_123',
        amount: 50000,
        currency: 'INR',
        status: 'captured'
      }), { status: 200 }));

    await expect(service.confirmPayment('pay_test_123', 'order_test_123', 50000, 'INR')).resolves.toEqual({
      paymentId: 'pay_test_123',
      amount: 50000,
      currency: 'INR'
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('https://api.razorpay.com/v1/payments/pay_test_123/capture', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ amount: 50000, currency: 'INR' })
    }));
  });

  it('fetches payment attempts attached to a Standard Checkout order', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'api-secret';
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      entity: 'collection',
      count: 1,
      items: [{
        id: 'pay_test_123',
        order_id: 'order_test_123',
        amount: 50000,
        currency: 'INR',
        status: 'captured'
      }]
    }), { status: 200 }));

    await expect(service.fetchOrderPayments('order_test_123')).resolves.toEqual([{
      id: 'pay_test_123',
      orderId: 'order_test_123',
      amount: 50000,
      currency: 'INR',
      status: 'captured'
    }]);
    expect(fetch).toHaveBeenCalledWith('https://api.razorpay.com/v1/orders/order_test_123/payments', expect.objectContaining({
      method: 'GET'
    }));
  });
});
