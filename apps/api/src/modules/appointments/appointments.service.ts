import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AccountStatus, AgentApproval, AppointmentMode, AppointmentStatus, ConsentType, Prisma, Role } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoogleCalendarService } from './google-calendar.service';
import type { AuthUser } from '../../common/auth';

const OPEN_STATUSES: AppointmentStatus[] = [AppointmentStatus.REQUESTED, AppointmentStatus.AGENT_ASSIGNED, AppointmentStatus.CONFIRMED];

interface BookingInput {
  propertyId: string;
  mode: AppointmentMode;
  startUtc: string;
  notes?: string;
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(date);
}

function createRoomName(): string {
  return `landtrack-${randomUUID().replace(/-/g, '')}`;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly googleCalendar: GoogleCalendarService
  ) {}

  async slots(dateValue: string, timeZone: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) throw new BadRequestException({ code: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD.' });
    try {
      new Intl.DateTimeFormat('en', { timeZone }).format(new Date());
    } catch {
      throw new BadRequestException({ code: 'INVALID_TIMEZONE', message: 'The requested time zone is invalid.' });
    }
    const date = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) throw new BadRequestException({ code: 'INVALID_DATE', message: 'Date is invalid.' });
    const day = date.getUTCDay();
    const exception = await this.prisma.slotException.findUnique({ where: { date } });
    if (exception) return { date: dateValue, slots: [] };
    const templates = await this.prisma.slotTemplate.findMany({ where: { dayOfWeek: day, active: true } });
    const startOfDay = new Date(`${dateValue}T00:00:00+05:30`);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60_000);
    const booked = await this.prisma.appointment.findMany({
      where: { startUtc: { gte: startOfDay, lt: endOfDay }, status: { in: OPEN_STATUSES } },
      select: { startUtc: true }
    });
    const output: Array<{ startUtc: string; endUtc: string; localTime: string; istTime: string; available: boolean }> = [];
    for (const template of templates) {
      const [startHour, startMinute] = template.startTime.split(':').map(Number);
      const [endHour, endMinute] = template.endTime.split(':').map(Number);
      let minute = startHour * 60 + startMinute;
      const finish = endHour * 60 + endMinute;
      while (minute + template.durationMin <= finish) {
        const startUtc = new Date(`${dateValue}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00+05:30`);
        const endUtc = new Date(startUtc.getTime() + template.durationMin * 60_000);
        const count = booked.filter((booking) => booking.startUtc.getTime() === startUtc.getTime()).length;
        output.push({
          startUtc: startUtc.toISOString(),
          endUtc: endUtc.toISOString(),
          localTime: formatTime(startUtc, timeZone),
          istTime: formatTime(startUtc, 'Asia/Kolkata'),
          available: count < template.capacity
        });
        minute += template.durationMin;
      }
    }
    return { date: dateValue, timeZone, slots: output };
  }

  async book(input: BookingInput, user: AuthUser, ip?: string, userAgent?: string, sendNotifications = true) {
    if (!this.googleCalendar.isConfigured()) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_NOT_CONFIGURED', message: 'Google Calendar booking is not configured. An administrator must connect the admin Google account before appointments can be booked.' });
    }
    const property = await this.prisma.property.findUnique({ where: { id: input.propertyId } });
    if (!property || (user.role !== Role.ADMIN && property.ownerId !== user.sub)) {
      throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    }
    const bookingRequiresApproval = await this.prisma.setting.findUnique({ where: { key: 'requireApprovalBeforeBooking' } });
    if (bookingRequiresApproval?.value !== false && property.status !== 'APPROVED') {
      throw new BadRequestException({ code: 'PROPERTY_NOT_APPROVED', message: 'The property must be approved before booking an appointment.' });
    }
    const start = new Date(input.startUtc);
    if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now()) throw new BadRequestException({ code: 'INVALID_SLOT', message: 'The appointment slot must be a valid future time.' });
    const dayString = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
    const [localHour, localMinute] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start).split(':').map(Number);
    const templates = await this.prisma.slotTemplate.findMany({ where: { dayOfWeek: new Date(`${dayString}T00:00:00Z`).getUTCDay(), active: true } });
    const exact = templates.find((template) => {
      const [fromH, fromM] = template.startTime.split(':').map(Number);
      const [toH, toM] = template.endTime.split(':').map(Number);
      const minute = localHour * 60 + localMinute;
      return minute >= fromH * 60 + fromM && minute + template.durationMin <= toH * 60 + toM && (minute - (fromH * 60 + fromM)) % template.durationMin === 0;
    });
    if (!exact || exact.dayOfWeek !== new Date(`${dayString}T00:00:00Z`).getUTCDay()) {
      throw new BadRequestException({ code: 'SLOT_UNAVAILABLE', message: 'The selected time is not part of an active appointment slot.' });
    }
    const exception = await this.prisma.slotException.findUnique({ where: { date: new Date(`${dayString}T00:00:00.000Z`) } });
    if (exception) throw new BadRequestException({ code: 'SLOT_UNAVAILABLE', message: 'Appointments are not available on this date.' });
    const end = new Date(start.getTime() + exact.durationMin * 60_000);
    const appointment = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${start.toISOString()}))`;
      const count = await transaction.appointment.count({ where: { startUtc: start, status: { in: OPEN_STATUSES } } });
      if (count >= exact.capacity) throw new BadRequestException({ code: 'SLOT_FULL', message: 'This appointment slot was just taken. Select another time.' });
      const created = await transaction.appointment.create({
        data: {
          propertyId: property.id, nriId: user.role === Role.ADMIN ? property.ownerId : user.sub,
          mode: input.mode, startUtc: start, endUtc: end, notes: input.notes?.trim(),
          conversation: { create: { propertyId: property.id, participants: { create: [{ userId: user.role === Role.ADMIN ? property.ownerId : user.sub }] } } },
          ...(input.mode !== AppointmentMode.SITE_VISIT ? { call: { create: { roomName: createRoomName(), mode: input.mode, scheduledStart: start } } } : {})
        },
        include: { property: true, nri: { select: { id: true, name: true, email: true, whatsappNumber: true } }, conversation: true }
      });
      return created;
    }, { isolationLevel: 'Serializable' });
    let calendarEvent: { eventId: string; meetUrl: string | null } | undefined;
    try {
      calendarEvent = await this.googleCalendar.createAppointment({
        appointmentId: appointment.id,
        propertyName: appointment.property.name,
        nriName: appointment.nri.name,
        nriEmail: appointment.nri.email,
        mode: appointment.mode,
        startUtc: appointment.startUtc,
        endUtc: appointment.endUtc
      });
      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { googleCalendarEventId: calendarEvent.eventId, googleMeetUrl: calendarEvent.meetUrl }
      });
    } catch (cause) {
      await this.prisma.appointment.update({ where: { id: appointment.id }, data: { status: AppointmentStatus.CANCELLED } });
      if (calendarEvent) {
        try {
          await this.googleCalendar.deleteEvent(calendarEvent.eventId);
        } catch (cleanupError) {
          console.error(`Failed to remove Google Calendar event for cancelled appointment ${appointment.id}.`, cleanupError);
        }
      }
      throw cause;
    }
    if (!calendarEvent) throw new ServiceUnavailableException({ code: 'GOOGLE_CALENDAR_EVENT_FAILED', message: 'Google Calendar did not create the appointment. Please try again.' });
    if (sendNotifications) {
      await this.notifications.queueEmail(process.env.GOOGLE_CALENDAR_ADMIN_EMAIL || 'adminlandtrack@gmail.com', 'New NRI Land Tracking System appointment request', `${appointment.nri.name} requested a ${appointment.mode} appointment for ${appointment.property.name} at ${appointment.startUtc.toISOString()}.`);
      if (appointment.nri.whatsappNumber) {
        await this.notifications.queueWhatsApp(appointment.nri.id, appointment.nri.whatsappNumber, 'appointment_requested_admin', { propertyName: appointment.property.name });
      }
      await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'APPOINTMENT_REQUESTED', entity: 'Appointment', entityId: appointment.id, after: { status: appointment.status, startUtc: appointment.startUtc }, ip, userAgent });
    }
    return { ...appointment, googleCalendarEventId: calendarEvent.eventId, googleMeetUrl: calendarEvent.meetUrl };
  }

  async list(user: AuthUser) {
    const where: Prisma.AppointmentWhereInput = user.role === Role.ADMIN
      ? {}
      : user.role === Role.AGENT
        ? { agentId: user.sub }
        : { nriId: user.sub };
    return this.prisma.appointment.findMany({
      where, orderBy: { startUtc: 'asc' },
      include: { property: { select: { id: true, name: true, status: true } }, nri: { select: { id: true, name: true } }, agent: { select: { id: true, name: true } }, call: true, conversation: { select: { id: true } } }
    });
  }

  async get(id: string, user: AuthUser) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: { property: true, nri: { select: { id: true, name: true, email: true, mobile: true, timeZone: true } }, agent: { select: { id: true, name: true, email: true } }, call: true, conversation: true }
    });
    if (!appointment) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment was not found.' });
    if (user.role === Role.NRI && appointment.nriId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'You cannot access this appointment.' });
    if (user.role === Role.AGENT && appointment.agentId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'You cannot access this appointment.' });
    return appointment;
  }

  async cancel(id: string, user: AuthUser, ip?: string, userAgent?: string) {
    const appointment = await this.get(id, user);
    if (user.role !== Role.ADMIN && appointment.nriId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'Only the owner can cancel this appointment.' });
    if (appointment.status === AppointmentStatus.CONFIRMED || (appointment.status !== AppointmentStatus.REQUESTED && appointment.status !== AppointmentStatus.AGENT_ASSIGNED)) {
      throw new BadRequestException({ code: 'APPOINTMENT_NOT_CANCELLABLE', message: 'This appointment cannot be cancelled in its current status.' });
    }
    const hours = Number((await this.prisma.setting.findUnique({ where: { key: 'appointmentCancelCutoffHours' } }))?.value ?? 2);
    if (appointment.startUtc.getTime() - Date.now() < hours * 60 * 60_000) throw new BadRequestException({ code: 'CANCELLATION_CUTOFF', message: `Appointments must be cancelled at least ${hours} hours before their start time.` });
    const result = await this.prisma.appointment.update({ where: { id }, data: { status: AppointmentStatus.CANCELLED } });
    if (appointment.googleCalendarEventId) await this.googleCalendar.deleteEvent(appointment.googleCalendarEventId);
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'APPOINTMENT_CANCELLED', entity: 'Appointment', entityId: id, ip, userAgent });
    return result;
  }

  async reschedule(id: string, startUtc: string, user: AuthUser, ip?: string, userAgent?: string) {
    const old = await this.get(id, user);
    if (user.role !== Role.ADMIN && old.nriId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'Only the owner can reschedule this appointment.' });
    if (old.status === AppointmentStatus.CONFIRMED || (old.status !== AppointmentStatus.REQUESTED && old.status !== AppointmentStatus.AGENT_ASSIGNED)) {
      throw new BadRequestException({ code: 'APPOINTMENT_NOT_RESCHEDULABLE', message: 'This appointment cannot be rescheduled in its current status.' });
    }
    await this.cancelCutoff(old.startUtc);
    const next = await this.book({ propertyId: old.propertyId, mode: old.mode, startUtc, notes: old.notes ?? undefined }, user, ip, userAgent, false);
    const movedCount = await this.prisma.appointment.updateMany({
      where: { id, status: old.status },
      data: { status: AppointmentStatus.RESCHEDULED }
    });
    if (movedCount.count !== 1) {
      await this.prisma.appointment.updateMany({ where: { id: next.id, status: AppointmentStatus.REQUESTED }, data: { status: AppointmentStatus.CANCELLED } });
      throw new ConflictException({ code: 'APPOINTMENT_CHANGED', message: 'The appointment changed while it was being rescheduled. Refresh and try again.' });
    }
    const moved = await this.prisma.appointment.findUniqueOrThrow({ where: { id } });
    if (old.googleCalendarEventId) await this.googleCalendar.deleteEvent(old.googleCalendarEventId);
    await this.notifications.queueEmail(process.env.GOOGLE_CALENDAR_ADMIN_EMAIL || 'adminlandtrack@gmail.com', 'New NRI Land Tracking System appointment request', `${next.nri.name} rescheduled a ${next.mode} appointment for ${next.property.name} at ${next.startUtc.toISOString()}.`);
    if (next.nri.whatsappNumber) {
      await this.notifications.queueWhatsApp(next.nri.id, next.nri.whatsappNumber, 'appointment_requested_admin', { propertyName: next.property.name });
    }
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'APPOINTMENT_RESCHEDULED', entity: 'Appointment', entityId: moved.id, before: { status: old.status, startUtc: old.startUtc }, after: { status: moved.status, replacementId: next.id, replacementStartUtc: next.startUtc }, ip, userAgent });
    if (old.agentId) {
      await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'APPOINTMENT_RESCHEDULED_AGENT_RELEASED', entity: 'Appointment', entityId: moved.id });
    }
    return { previousAppointment: moved, appointment: next };
  }

  async confirm(id: string, user: AuthUser, ip?: string, userAgent?: string) {
    const appointment = await this.get(id, user);
    if (user.role === Role.AGENT && appointment.agentId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'Only the assigned agent can confirm this appointment.' });
    if (appointment.status !== AppointmentStatus.AGENT_ASSIGNED) throw new BadRequestException({ code: 'INVALID_APPOINTMENT_TRANSITION', message: 'Only an assigned appointment can be confirmed.' });
    return this.transition(appointment, AppointmentStatus.CONFIRMED, user, ip, userAgent);
  }

  async complete(id: string, user: AuthUser, outcome: 'COMPLETED' | 'NO_SHOW', ip?: string, userAgent?: string) {
    const appointment = await this.get(id, user);
    if (user.role === Role.AGENT && appointment.agentId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'Only the assigned agent can update this appointment.' });
    if (appointment.status !== AppointmentStatus.CONFIRMED) throw new BadRequestException({ code: 'INVALID_APPOINTMENT_TRANSITION', message: 'Only a confirmed appointment can be completed or marked no-show.' });
    return this.transition(appointment, outcome === 'COMPLETED' ? AppointmentStatus.COMPLETED : AppointmentStatus.NO_SHOW, user, ip, userAgent);
  }

  async assign(id: string, agentId: string, admin: AuthUser, ip?: string, userAgent?: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id }, include: { property: true, conversation: true } });
    if (!appointment) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment was not found.' });
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, role: Role.AGENT, status: AccountStatus.ACTIVE, agentProfile: { is: { approval: AgentApproval.APPROVED } } },
      select: { id: true, name: true, email: true, whatsappNumber: true }
    });
    if (!agent) throw new BadRequestException({ code: 'AGENT_NOT_AVAILABLE', message: 'The selected agent is not approved and active.' });
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Appointment" WHERE "id" = ${id} FOR UPDATE`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${agentId}))`;
      const current = await transaction.appointment.findUnique({ where: { id } });
      if (!current) throw new NotFoundException({ code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment was not found.' });
      if (current.status !== AppointmentStatus.REQUESTED && current.status !== AppointmentStatus.AGENT_ASSIGNED) {
        throw new BadRequestException({ code: 'INVALID_APPOINTMENT_TRANSITION', message: 'Only a pending appointment can be assigned or reassigned.' });
      }
      const conflict = await transaction.appointment.findFirst({
        where: { agentId, id: { not: id }, status: { in: OPEN_STATUSES }, startUtc: { lt: current.endUtc }, endUtc: { gt: current.startUtc } }
      });
      if (conflict) throw new BadRequestException({ code: 'AGENT_SLOT_CONFLICT', message: 'This agent already has an appointment during that time.' });
      const updated = await transaction.appointment.update({
        where: { id },
        data: { agentId, assignedAt: new Date(), assignedById: admin.sub, status: AppointmentStatus.AGENT_ASSIGNED },
        include: { property: true, nri: { select: { id: true, name: true, email: true, whatsappNumber: true } }, agent: { select: { id: true, name: true, email: true, whatsappNumber: true } }, conversation: true }
      });
      if (updated.conversation) await transaction.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId: updated.conversation.id, userId: agent.id } },
        create: { conversationId: updated.conversation.id, userId: agent.id },
        update: {}
      });
      return updated;
    });
    await this.notifications.queueEmail(result.nri.email, 'NRI Land Tracking System agent assigned', `${agent.name} has been assigned to your appointment for ${result.property.name}.`, result.nri.id);
    await this.notifications.queueEmail(agent.email, 'New NRI Land Tracking System appointment assigned', `You have been assigned an appointment for ${result.property.name} at ${result.startUtc.toISOString()}.`, agent.id);
    if (result.nri.whatsappNumber) await this.notifications.queueWhatsApp(result.nri.id, result.nri.whatsappNumber, 'appointment_assigned', { agentName: agent.name, propertyName: result.property.name });
    if (agent.whatsappNumber) await this.notifications.queueWhatsApp(agent.id, agent.whatsappNumber, 'appointment_assigned', { propertyName: result.property.name });
    await this.audit.record({ actorId: admin.sub, actorRole: admin.role, action: 'APPOINTMENT_ASSIGNED', entity: 'Appointment', entityId: id, before: { agentId: appointment.agentId }, after: { agentId }, ip, userAgent });
    return result;
  }

  async callToken(id: string, user: AuthUser) {
    const appointment = await this.get(id, user);
    if (appointment.mode === AppointmentMode.SITE_VISIT || !appointment.call) throw new BadRequestException({ code: 'CALL_NOT_AVAILABLE', message: 'This appointment does not have an audio or video call.' });
    if (user.role === Role.NRI && appointment.nriId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'You cannot join this call.' });
    if (user.role === Role.AGENT && appointment.agentId !== user.sub) throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'Only the assigned agent can join this call.' });
    const now = Date.now();
    if (now < appointment.startUtc.getTime() - 10 * 60_000 || now > appointment.endUtc.getTime() + 60 * 60_000) {
      throw new BadRequestException({ code: 'CALL_OUTSIDE_JOIN_WINDOW', message: 'Calls can be joined from 10 minutes before the start until 60 minutes after the end.' });
    }
    const call = appointment.call;
    const recordingEnabled = (await this.prisma.setting.findUnique({ where: { key: 'recordingEnabled' } }))?.value === true;
    const userConsent = await this.prisma.consent.findFirst({ where: { userId: user.sub, type: ConsentType.RECORDING, withdrawnAt: null } });
    return {
      roomUrl: `https://${process.env.JITSI_DOMAIN}/${call.roomName}`,
      token: this.makeJitsiToken(call.roomName, user, user.role === Role.ADMIN || user.role === Role.AGENT),
      recordingConsentRequired: recordingEnabled && !userConsent,
      callId: call.id
    };
  }

  async recordingConsent(id: string, user: AuthUser, accepted: boolean) {
    const appointment = await this.get(id, user);
    const setting = await this.prisma.setting.findUnique({ where: { key: 'recordingEnabled' } });
    if (setting?.value !== true) return { recording: false, status: 'disabled' };
    if (![appointment.nriId, appointment.agentId].includes(user.sub) && user.role !== Role.ADMIN) {
      throw new ForbiddenException({ code: 'APPOINTMENT_ACCESS_DENIED', message: 'You cannot update recording consent for this call.' });
    }
    await this.prisma.$transaction(async (transaction) => {
      const call = await transaction.call.findUniqueOrThrow({ where: { appointmentId: id } });
      const consents = new Set(call.recordingConsentBy);
      if (accepted) consents.add(user.sub);
      else consents.delete(user.sub);
      const expected = [appointment.nriId, appointment.agentId].filter((person): person is string => person !== null);
      const allAccepted = expected.length > 0 && expected.every((person) => consents.has(person));
      await transaction.call.update({
        where: { id: call.id },
        data: { recordingConsentBy: [...consents], recordingConsentAll: allAccepted }
      });
      if (accepted) {
        await transaction.consent.create({ data: { userId: user.sub, type: ConsentType.RECORDING, version: '1.0' } });
      }
    });
    return { recording: true, status: 'consent_recorded' };
  }

  async handleJitsiWebhook(payload: unknown, secret: string | undefined) {
    if (!secret || secret !== process.env.JITSI_WEBHOOK_SECRET) throw new ForbiddenException({ code: 'WEBHOOK_INVALID', message: 'Jitsi webhook authorization failed.' });
    if (!payload || typeof payload !== 'object') throw new BadRequestException({ code: 'WEBHOOK_INVALID', message: 'Jitsi webhook payload is invalid.' });
    const event = payload as Record<string, unknown>;
    const roomName = String(event.room ?? event.roomName ?? '');
    const call = await this.prisma.call.findUnique({ where: { roomName } });
    if (!call) throw new NotFoundException({ code: 'CALL_NOT_FOUND', message: 'Call room was not found.' });
    const now = new Date();
    const callEvents = Array.isArray(call.events) ? call.events : [];
    const updatedEvents = [...callEvents, { event: String(event.event ?? ''), at: now.toISOString() }];
    const type = String(event.event ?? '');
    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: {
        events: updatedEvents as Prisma.InputJsonValue,
        ...(type.includes('joined') || type.includes('created') ? { actualStart: call.actualStart ?? now, status: 'ACTIVE' } : {}),
        ...(type.includes('left') || type.includes('destroyed') ? { actualEnd: now, status: 'COMPLETED' } : {}),
        ...(typeof event.recordingKey === 'string' && call.recordingConsentAll ? { recordingKey: event.recordingKey } : {})
      }
    });
    return { status: updated.status };
  }

  async adminList(status?: AppointmentStatus, date?: string) {
    const from = date ? new Date(`${date}T00:00:00+05:30`) : undefined;
    const to = from ? new Date(from.getTime() + 24 * 60 * 60_000) : undefined;
    return this.prisma.appointment.findMany({
      where: { status, ...(from && to ? { startUtc: { gte: from, lt: to } } : {}) },
      orderBy: { startUtc: 'asc' },
      include: { property: { include: { district: true } }, nri: { select: { id: true, name: true, email: true } }, agent: { select: { id: true, name: true } } }
    });
  }

  private async transition(appointment: { id: string; status: AppointmentStatus; nriId: string; propertyId: string }, next: AppointmentStatus, user: AuthUser, ip?: string, userAgent?: string) {
    const updated = await this.prisma.appointment.update({ where: { id: appointment.id }, data: { status: next } });
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: `APPOINTMENT_${next}`, entity: 'Appointment', entityId: appointment.id, before: { status: appointment.status }, after: { status: next }, ip, userAgent });
    return updated;
  }

  private async cancelCutoff(startUtc: Date) {
    const hours = Number((await this.prisma.setting.findUnique({ where: { key: 'appointmentCancelCutoffHours' } }))?.value ?? 2);
    if (startUtc.getTime() - Date.now() < hours * 60 * 60_000) throw new BadRequestException({ code: 'CANCELLATION_CUTOFF', message: `Appointments must be changed at least ${hours} hours before their start time.` });
  }

  private makeJitsiToken(room: string, user: AuthUser, moderator: boolean): string {
    if (!process.env.JITSI_APP_SECRET) throw new Error('JITSI_APP_SECRET must be configured before issuing call tokens.');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      aud: 'jitsi', iss: process.env.JITSI_APP_ID, sub: process.env.JITSI_DOMAIN, room,
      iat: now, nbf: now - 5, exp: now + 60 * 60,
      context: { user: { id: user.sub, name: user.email, moderator } }
    })).toString('base64url');
    const body = `${header}.${payload}`;
    const signature = createHmac('sha256', process.env.JITSI_APP_SECRET!).update(body).digest('base64url');
    return `${body}.${signature}`;
  }
}
