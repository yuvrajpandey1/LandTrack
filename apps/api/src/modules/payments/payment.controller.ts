import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from '../../common/auth';
import { Role } from '@prisma/client';
import { ZodPipe } from '../../common/zod.pipe';
import { PaymentsService } from './payments.service';

const paymentLinkCallbackSchema = z.object({
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_payment_link_id: z.string().min(1).max(100),
  razorpay_payment_link_reference_id: z.string().uuid(),
  razorpay_payment_link_status: z.string().min(1).max(40),
  razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/)
});
const standardCheckoutCallbackSchema = z.object({
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().regex(/^[a-fA-F0-9]{64}$/)
});
const standardCheckoutOrderSchema = z.object({
  orderId: z.string().min(1).max(100)
});

@ApiTags('payments')
@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('webhooks/payments')
  webhook(@Req() request: RawBodyRequest<Request>, @Headers('x-razorpay-signature') razorpaySignature?: string) {
    const rawBody = request.rawBody;
    if (!rawBody) throw new Error('Raw payment webhook body is unavailable.');
    const payload: unknown = request.body;
    const signature = process.env.PAYMENT_PROVIDER === 'fake' ? request.headers['x-landtrack-signature'] as string | undefined : razorpaySignature;
    return this.payments.handleWebhook(rawBody, signature, payload);
  }

  @Roles(Role.NRI)
  @ApiBearerAuth()
  @Post('payments/verify-link')
  verifyPaymentLink(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(paymentLinkCallbackSchema)) body: z.infer<typeof paymentLinkCallbackSchema>
  ) {
    if (process.env.PAYMENT_PROVIDER !== 'razorpay') {
      throw new BadRequestException({ code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'Razorpay payment verification is not enabled.' });
    }
    return this.payments.verifyPaymentLink(user.sub, {
      paymentLinkId: body.razorpay_payment_link_id,
      referenceId: body.razorpay_payment_link_reference_id,
      status: body.razorpay_payment_link_status,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature
    });
  }

  @Roles(Role.NRI)
  @ApiBearerAuth()
  @Post('payments/verify')
  verifyCheckoutPayment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(standardCheckoutCallbackSchema)) body: z.infer<typeof standardCheckoutCallbackSchema>
  ) {
    return this.payments.verifyCheckoutPayment(user.sub, {
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature
    });
  }

  @Roles(Role.NRI)
  @ApiBearerAuth()
  @Post('payments/confirm-order')
  confirmCheckoutOrder(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(standardCheckoutOrderSchema)) body: z.infer<typeof standardCheckoutOrderSchema>
  ) {
    return this.payments.confirmCheckoutOrder(user.sub, body.orderId);
  }

  @Roles(Role.NRI)
  @ApiBearerAuth()
  @Post('payments/demo-confirm-exit')
  confirmDemoCheckoutExit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(standardCheckoutOrderSchema)) body: z.infer<typeof standardCheckoutOrderSchema>
  ) {
    return this.payments.confirmDemoCheckoutExit(user.sub, body.orderId);
  }

  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  @Get('payments')
  list(@CurrentUser() user: AuthUser) {
    return this.payments.list(user.sub, user.role);
  }

  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  @Get('payments/:id/receipt')
  receipt(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.payments.receipt(id, user.sub, user.role);
  }

  @Public()
  @Get('dev/checkout/:orderId')
  async sandboxCheckout(@Param('orderId') orderId: string, @Res() response: Response) {
    if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_PROVIDER !== 'fake') {
      response.status(404).send('Not found');
      return;
    }
    response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NRI Land Tracking System sandbox checkout</title></head><body style="font:16px system-ui;max-width:480px;margin:15vh auto;padding:24px;color:#172554"><h1>Sandbox checkout</h1><p>This local-only checkout does not collect card data or move money.</p><form method="post" action="/api/v1/dev/checkout/${encodeURIComponent(orderId)}/complete"><button style="background:#2457d6;border:0;border-radius:8px;color:white;padding:12px 18px;font:inherit">Simulate successful payment</button></form><p><a href="/api/v1/dev/checkout/${encodeURIComponent(orderId)}/fail">Simulate failed payment</a></p></body></html>`);
  }

  @Public()
  @Post('dev/checkout/:orderId/complete')
  async completeFakePayment(@Param('orderId') orderId: string, @Res() response: Response) {
    await this.payments.simulatePayment(orderId);
    response.redirect(303, `${process.env.APP_URL}/app/payments?payment=success&provider=fake&orderId=${encodeURIComponent(orderId)}`);
  }

  @Public()
  @Get('dev/checkout/:orderId/fail')
  async failFakePayment(@Param('orderId') orderId: string, @Res() response: Response) {
    if (process.env.NODE_ENV === 'production' || process.env.PAYMENT_PROVIDER !== 'fake') {
      response.status(404).send('Not found');
      return;
    }
    response.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sandbox payment cancelled</title></head><body style="font:16px system-ui;max-width:480px;margin:15vh auto;padding:24px;color:#172554"><h1>Payment not completed</h1><p>You can return to the NRI Land Tracking System and retry checkout.</p><a href="${process.env.APP_URL}/app/payments?payment=failed">Return to NRI Land Tracking System</a></body></html>`);
  }
}
