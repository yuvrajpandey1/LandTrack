import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountStatus, AppointmentStatus, Role } from '@prisma/client';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AdminService } from './admin.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { PrismaService } from '../../database/prisma.service';

const userStatusSchema = z.object({ status: z.enum(AccountStatus) });
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const createAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  mobile: z.string().regex(/^\+[1-9]\d{7,14}$/),
  role: z.enum([Role.ADMIN, Role.AUDITOR])
});
const settingsSchema = z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0);
const masterKind = z.enum(['districts', 'talukas', 'villages']);
const createMasterSchema = z.object({ name: z.string().trim().min(2).max(120), districtId: z.string().uuid().optional(), talukaId: z.string().uuid().optional() });
const updateMasterSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
  districtId: z.string().uuid().optional(),
  talukaId: z.string().uuid().optional()
}).refine((value) => Object.keys(value).length > 0);
const importSchema = z.object({
  districts: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    talukas: z.array(z.object({ name: z.string().trim().min(2).max(120), villages: z.array(z.string().trim().min(2).max(120)) }))
  })).min(1)
});
const slotsSchema = z.object({
  templates: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    durationMin: z.number().int().min(15).max(120),
    capacity: z.number().int().min(1).max(20)
  })).optional(),
  blockedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().max(500).optional()
}).refine((value) => Boolean(value.templates || value.blockedDate));
const userQuery = z.object({ q: z.string().max(120).optional(), status: z.enum(AccountStatus).optional() });
const exportType = z.enum(['properties', 'payments', 'appointments', 'communications']);
const appointmentQuery = z.object({ status: z.enum(AppointmentStatus).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly appointments: AppointmentsService, private readonly prisma: PrismaService) {}

  @Get('dashboard')
  dashboard() { return this.admin.dashboard(); }

  @Get('users')
  users(@Query(new ZodPipe(userQuery)) query: z.infer<typeof userQuery>) {
    return this.admin.users(query.q, query.status);
  }

  @Patch('users/:id/status')
  setUserStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(userStatusSchema)) body: z.infer<typeof userStatusSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.setUserStatus(id, body.status, user);
  }

  @Post('users')
  createPrivilegedUser(@Body(new ZodPipe(createAdminSchema)) body: z.infer<typeof createAdminSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.createAdmin(body, user);
  }

  @Get('agents')
  agents() { return this.admin.agents(); }

  @Post('agents/:id/approve')
  approveAgent(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.admin.reviewAgent(id, user, true);
  }

  @Post('agents/:id/reject')
  rejectAgent(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.reviewAgent(id, user, false, body.reason);
  }

  @Get('payments')
  payments() { return this.admin.payments(); }

  @Get('appointments')
  appointmentsList(@Query(new ZodPipe(appointmentQuery)) query: z.infer<typeof appointmentQuery>) {
    return this.appointments.adminList(query.status, query.date);
  }

  @Get('conversations')
  conversations() { return this.admin.communications().then((result) => result.conversations); }

  @Get('calls')
  calls() { return this.admin.communications().then((result) => result.calls); }

  @Get('settings')
  settings() { return this.admin.settings(); }

  @Put('settings')
  settingsUpdate(@Body(new ZodPipe(settingsSchema)) body: z.infer<typeof settingsSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.updateSettings(body, user);
  }

  @Get('slots')
  slots() { return this.admin.listSlots(); }

  @Post('slots')
  updateSlots(@Body(new ZodPipe(slotsSchema)) body: z.infer<typeof slotsSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.manageSlots(body, user);
  }

  @Get('masters')
  async masters() {
    const districts = await this.prisma.district.findMany({
      orderBy: { name: 'asc' }, include: { talukas: { orderBy: { name: 'asc' }, include: { villages: { orderBy: { name: 'asc' } } } } }
    });
    return districts;
  }

  @Post('masters/import')
  importMasters(@Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.importMasters(body, user);
  }

  @Post('masters/:kind')
  createMaster(@Param('kind', new ZodPipe(masterKind)) kind: z.infer<typeof masterKind>, @Body(new ZodPipe(createMasterSchema)) body: z.infer<typeof createMasterSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.createMaster(kind, body, user);
  }

  @Patch('masters/:kind/:id')
  updateMaster(@Param('kind', new ZodPipe(masterKind)) kind: z.infer<typeof masterKind>, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(updateMasterSchema)) body: z.infer<typeof updateMasterSchema>, @CurrentUser() user: AuthUser) {
    return this.admin.updateMaster(kind, id, body, user);
  }

  @Delete('masters/:kind/:id')
  deactivateMaster(@Param('kind', new ZodPipe(masterKind)) kind: z.infer<typeof masterKind>, @Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.admin.updateMaster(kind, id, { active: false }, user);
  }

  @Get('reports/export')
  @Header('content-type', 'text/csv; charset=utf-8')
  async export(@Query('type', new ZodPipe(exportType)) type: z.infer<typeof exportType>, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const csv = await this.admin.exports(type, user);
    response.setHeader('content-disposition', `attachment; filename="landtrack-${type}.csv"`);
    response.send(csv);
  }

}
