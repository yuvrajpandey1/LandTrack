import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppointmentStatus, Role } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AppointmentsService } from './appointments.service';

const assignSchema = z.object({ agentId: z.string().uuid() });
const statusValues = Object.values(AppointmentStatus);
const querySchema = z.object({
  status: z.enum(statusValues).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/appointments')
export class AdminAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@Query(new ZodPipe(querySchema)) query: z.infer<typeof querySchema>) {
    return this.appointments.adminList(query.status, query.date);
  }

  @Post(':id/assign')
  assign(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(assignSchema)) body: z.infer<typeof assignSchema>, @CurrentUser() user: AuthUser, @Ip() ip: string, @Req() request: Request) {
    return this.appointments.assign(id, body.agentId, user, ip, request.headers['user-agent']);
  }
}
