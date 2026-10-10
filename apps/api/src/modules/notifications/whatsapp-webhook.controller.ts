import { BadRequestException, Controller, Get, Headers, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth';
import { NotificationsService } from './notifications.service';

@ApiTags('webhooks')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response
  ) {
    response.type('text/plain').send(this.notifications.verifyWhatsAppWebhook(mode, token, challenge));
  }

  @Public()
  @Post()
  handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Res() response: Response
  ) {
    if (!request.rawBody) throw new BadRequestException({ code: 'WEBHOOK_BODY_MISSING', message: 'The raw webhook body is required.' });
    return this.notifications.handleWhatsAppWebhook(request.rawBody, signature, request.body)
      .then((result) => response.status(200).json(result));
  }
}
