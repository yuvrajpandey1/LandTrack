import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppointmentMode, Role } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentUser, Public, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AppointmentsService } from './appointments.service';

const bookingSchema = z.object({
  propertyId: z.string().uuid(),
  mode: z.enum(AppointmentMode),
  startUtc: z.string().datetime({ offset: true }),
  notes: z.string().max(1000).optional()
});
const rescheduleSchema = z.object({ startUtc: z.string().datetime({ offset: true }) });
const slotQuerySchema = z.object({
  date: z.string(),
  tz: z.string().default('Asia/Kolkata')
});
const recordingConsentSchema = z.object({ accepted: z.boolean() });

@ApiTags('appointments')
@Controller()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('slots')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  slots(@Query(new ZodPipe(slotQuerySchema)) query: z.infer<typeof slotQuerySchema>) {
    return this.appointments.slots(query.date, query.tz);
  }

  @Post('appointments')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  book(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bookingSchema)) body: z.infer<typeof bookingSchema>, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.book(body, user, ip, request.headers['user-agent']);
  }

  @Get('appointments')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  list(@CurrentUser() user: AuthUser) {
    return this.appointments.list(user);
  }

  @Get('appointments/:id')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.appointments.get(id, user);
  }

  @Patch('appointments/:id/reschedule')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  reschedule(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(rescheduleSchema)) body: z.infer<typeof rescheduleSchema>, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.reschedule(id, body.startUtc, user, ip, request.headers['user-agent']);
  }

  @Post('appointments/:id/cancel')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.cancel(id, user, ip, request.headers['user-agent']);
  }

  @Post('appointments/:id/confirm')
  @Roles(Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  confirm(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.confirm(id, user, ip, request.headers['user-agent']);
  }

  @Post('appointments/:id/complete')
  @Roles(Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.complete(id, user, 'COMPLETED', ip, request.headers['user-agent']);
  }

  @Post('appointments/:id/no-show')
  @Roles(Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  noShow(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.complete(id, user, 'NO_SHOW', ip, request.headers['user-agent']);
  }

  @Post('appointments/:id/call-token')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  callToken(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.appointments.callToken(id, user);
  }

  @Post('appointments/:id/recording-consent')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  recordingConsent(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(recordingConsentSchema)) body: z.infer<typeof recordingConsentSchema>) {
    return this.appointments.recordingConsent(id, user, body.accepted);
  }

  @Public()
  @Post('webhooks/jitsi')
  jitsiWebhook(@Headers('x-landtrack-webhook-secret') secret: string | undefined, @Body() body: unknown) {
    return this.appointments.handleJitsiWebhook(body, secret);
  }
}
