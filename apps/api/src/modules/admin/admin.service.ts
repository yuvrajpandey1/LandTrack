import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, AgentApproval, AppointmentStatus, PropertyStatus, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit.service';
import { escapeCsvCell } from '../../common/csv';
import { toJsonInput } from '../../common/json';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../../common/auth';

const settingDefaults: Record<string, unknown> = {
  registrationChargeInr: 500,
  requireApprovalBeforeBooking: true,
  appointmentCancelCutoffHours: 2,
  slotDurationMin: 30,
  recordingEnabled: false,
  reminderHours: [24, 1],
  chatRetentionYears: 7,
  recordingRetentionMonths: 12
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  async dashboard() {
    const [properties, pending, agents, appointments, recent] = await Promise.all([
      this.prisma.property.count(),
      this.prisma.property.count({ where: { status: { in: [PropertyStatus.SUBMITTED, PropertyStatus.UNDER_REVIEW] } } }),
      this.prisma.user.count({ where: { role: Role.AGENT, status: AccountStatus.ACTIVE, agentProfile: { is: { approval: AgentApproval.APPROVED } } } }),
      this.prisma.appointment.count({ where: { status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.AGENT_ASSIGNED] } } }),
      this.prisma.property.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { district: true, owner: { select: { name: true } } } })
    ]);
    return { properties, pendingReview: pending, activeAgents: agents, pendingAssignments: appointments, recent };
  }

  async users(query?: string, status?: AccountStatus) {
    return this.prisma.user.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { email: { contains: query, mode: 'insensitive' } }, { mobile: { contains: query } }] } : {})
      },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, name: true, email: true, mobile: true, role: true, status: true, originCountry: true, currentCountry: true, createdAt: true, agentProfile: { select: { approval: true } } }
    });
  }

  async setUserStatus(id: string, status: AccountStatus, admin: AuthUser) {
    if (id === admin.sub) throw new BadRequestException({ code: 'SELF_STATUS_CHANGE', message: 'Administrators cannot suspend their own account.' });
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found.' });
    const updated = await this.prisma.user.update({ where: { id }, data: { status } });
    if (status === AccountStatus.SUSPENDED) {
      await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.record({ actorId: admin.sub, actorRole: admin.role, action: `USER_${status}`, entity: 'User', entityId: id, before: { status: user.status }, after: { status } });
    return { id: updated.id, status: updated.status };
  }

  async createAdmin(input: { name: string; email: string; mobile: string; role: Extract<Role, 'ADMIN' | 'AUDITOR'> }, actor: AuthUser) {
    if (await this.prisma.user.findUnique({ where: { email: input.email.toLowerCase() } })) {
      throw new ConflictException({ code: 'ACCOUNT_EXISTS', message: 'An account already uses this email address.' });
    }
    if (await this.prisma.user.findUnique({ where: { mobile: input.mobile } })) {
      throw new ConflictException({ code: 'ACCOUNT_EXISTS', message: 'An account already uses this mobile number.' });
    }
    const temporaryPassword = `${randomBytes(18).toString('base64url')}a7`;
    const user = await this.prisma.user.create({
      data: {
        name: input.name.trim(), email: input.email.toLowerCase(),
        mobile: input.mobile,
        passwordHash: await argon2.hash(temporaryPassword, { type: argon2.argon2id }),
        role: input.role, status: AccountStatus.ACTIVE
      }
    });
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'ADMIN_ACCOUNT_CREATED', entity: 'User', entityId: user.id, after: { role: input.role } });
    return { id: user.id, email: user.email, role: user.role, temporaryPassword, mfaSetupRequired: true };
  }

  async agents() {
    return this.prisma.user.findMany({
      where: { role: Role.AGENT }, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, mobile: true, status: true, createdAt: true, agentProfile: true }
    });
  }

  async reviewAgent(id: string, actor: AuthUser, approved: boolean, reason?: string) {
    const agent = await this.prisma.user.findFirst({ where: { id, role: Role.AGENT }, include: { agentProfile: true } });
    if (!agent || !agent.agentProfile) throw new NotFoundException({ code: 'AGENT_NOT_FOUND', message: 'Agent was not found.' });
    if (approved) {
      await this.prisma.agentProfile.update({
        where: { userId: id }, data: { approval: AgentApproval.APPROVED, approvedById: actor.sub, approvedAt: new Date(), rejectionReason: null }
      });
    } else {
      if (!reason?.trim()) throw new BadRequestException({ code: 'REJECTION_REASON_REQUIRED', message: 'A reason is required when rejecting an agent.' });
      await this.prisma.agentProfile.update({ where: { userId: id }, data: { approval: AgentApproval.REJECTED, rejectionReason: reason.trim() } });
    }
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: approved ? 'AGENT_APPROVED' : 'AGENT_REJECTED', entity: 'AgentProfile', entityId: id, before: { approval: agent.agentProfile.approval }, after: { approval: approved ? AgentApproval.APPROVED : AgentApproval.REJECTED, reason } });
    await this.notifications.queueEmail(agent.email, `LandTrack agent application ${approved ? 'approved' : 'updated'}`, approved ? 'Your agent profile has been approved.' : `Your agent application was not approved: ${reason}`);
    if (agent.whatsappNumber) await this.notifications.queueWhatsApp(id, agent.whatsappNumber, 'agent_approval_status', { approved: String(approved), reason: reason ?? '' });
    return { id, approval: approved ? AgentApproval.APPROVED : AgentApproval.REJECTED };
  }

  async settings() {
    const stored = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return { ...settingDefaults, ...Object.fromEntries(stored.map((item) => [item.key, item.value])) };
  }

  async updateSettings(values: Record<string, unknown>, actor: AuthUser) {
    const allowed = new Set(Object.keys(settingDefaults));
    const entries = Object.entries(values);
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new BadRequestException({ code: 'SETTING_INVALID', message: 'One or more settings are not supported.' });
    for (const [key, value] of entries) {
      if ((key === 'registrationChargeInr' && (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100_000))
        || (key === 'appointmentCancelCutoffHours' && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 168))
        || (key === 'slotDurationMin' && (!Number.isInteger(value) || Number(value) < 15 || Number(value) > 120))
        || (key === 'recordingEnabled' && typeof value !== 'boolean')
        || (key === 'requireApprovalBeforeBooking' && typeof value !== 'boolean')
        || (key === 'chatRetentionYears' && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 20))
        || (key === 'recordingRetentionMonths' && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 24))
        || (key === 'reminderHours' && (!Array.isArray(value) || value.some((hour) => !Number.isInteger(hour) || Number(hour) < 1 || Number(hour) > 168)))) {
        throw new BadRequestException({ code: 'SETTING_VALUE_INVALID', message: `The value for ${key} is invalid.` });
      }
    }
    const before = await this.settings();
    await this.prisma.$transaction(entries.map(([key, value]) =>
      this.prisma.setting.upsert({ where: { key }, create: { key, value: toJsonInput(value) }, update: { value: toJsonInput(value) } })
    ));
    const after = await this.settings();
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'SETTINGS_UPDATED', entity: 'Setting', before, after });
    return after;
  }

  async createMaster(kind: 'districts' | 'talukas' | 'villages', body: { name: string; districtId?: string; talukaId?: string }, actor: AuthUser) {
    let created: { id: string; name: string };
    if (kind === 'districts') created = await this.prisma.district.create({ data: { name: body.name.trim() } });
    else if (kind === 'talukas' && body.districtId) created = await this.prisma.taluka.create({ data: { name: body.name.trim(), districtId: body.districtId } });
    else if (kind === 'villages' && body.talukaId) created = await this.prisma.village.create({ data: { name: body.name.trim(), talukaId: body.talukaId } });
    else throw new BadRequestException({ code: 'MASTER_PARENT_REQUIRED', message: 'A district or taluka parent ID is required.' });
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'LOCATION_MASTER_CREATED', entity: kind, entityId: created.id, after: { name: created.name } });
    return created;
  }

  async updateMaster(kind: 'districts' | 'talukas' | 'villages', id: string, body: { name?: string; active?: boolean; districtId?: string; talukaId?: string }, actor: AuthUser) {
    const update = { ...body };
    const result = kind === 'districts'
      ? await this.prisma.district.update({ where: { id }, data: { name: update.name?.trim(), active: update.active } })
      : kind === 'talukas'
        ? await this.prisma.taluka.update({ where: { id }, data: { name: update.name?.trim(), active: update.active, districtId: update.districtId } })
        : await this.prisma.village.update({ where: { id }, data: { name: update.name?.trim(), active: update.active, talukaId: update.talukaId } });
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'LOCATION_MASTER_UPDATED', entity: kind, entityId: id, after: { name: result.name, active: result.active } });
    return result;
  }

  async importMasters(body: { districts: Array<{ name: string; talukas: Array<{ name: string; villages: string[] }> }> }, actor: AuthUser) {
    let imported = 0;
    for (const districtData of body.districts) {
      const district = await this.prisma.district.upsert({ where: { name: districtData.name }, create: { name: districtData.name }, update: { active: true } });
      for (const talukaData of districtData.talukas) {
        const taluka = await this.prisma.taluka.upsert({
          where: { districtId_name: { districtId: district.id, name: talukaData.name } },
          create: { districtId: district.id, name: talukaData.name },
          update: { active: true }
        });
        for (const villageName of talukaData.villages) {
          await this.prisma.village.upsert({
            where: { talukaId_name: { talukaId: taluka.id, name: villageName } },
            create: { talukaId: taluka.id, name: villageName },
            update: { active: true }
          });
          imported++;
        }
      }
    }
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'LOCATION_MASTER_IMPORTED', entity: 'LocationMaster', after: { villages: imported } });
    return { importedVillages: imported };
  }

  async manageSlots(input: {
    templates?: Array<{ dayOfWeek: number; startTime: string; endTime: string; durationMin: number; capacity: number }>;
    blockedDate?: string; reason?: string;
  }, actor: AuthUser) {
    let result: object;
    if (input.blockedDate) {
      const date = new Date(`${input.blockedDate}T00:00:00.000Z`);
      const blocked = await this.prisma.slotException.upsert({
        where: { date },
        create: { date, reason: input.reason },
        update: { reason: input.reason }
      });
      result = { blockedDate: blocked };
    } else if (input.templates) {
      await this.prisma.slotTemplate.deleteMany({});
      const templates = await this.prisma.slotTemplate.createMany({ data: input.templates });
      result = { created: templates.count };
    } else {
      throw new BadRequestException({ code: 'SLOT_RULE_REQUIRED', message: 'Provide templates or a date to block.' });
    }
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'SLOT_RULES_UPDATED', entity: 'SlotTemplate', after: result });
    return result;
  }

  listSlots() {
    return Promise.all([
      this.prisma.slotTemplate.findMany({ orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }),
      this.prisma.slotException.findMany({ orderBy: { date: 'asc' } })
    ]).then(([templates, exceptions]) => ({ templates, exceptions }));
  }

  async payments() {
    return this.prisma.payment.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { user: { select: { id: true, name: true, email: true } }, property: { select: { id: true, name: true } } } });
  }

  async communications() {
    const [conversations, calls] = await Promise.all([
      this.prisma.conversation.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { property: { select: { id: true, name: true } }, participants: { include: { user: { select: { id: true, name: true, role: true } } } }, messages: { orderBy: { sentAt: 'desc' }, take: 1 } } }),
      this.prisma.call.findMany({ orderBy: { scheduledStart: 'desc' }, take: 100, include: { appointment: { include: { property: { select: { name: true } }, nri: { select: { name: true } }, agent: { select: { name: true } } } } } })
    ]);
    return { conversations, calls };
  }

  async exports(type: 'properties' | 'payments' | 'appointments' | 'communications', actor: AuthUser): Promise<string> {
    const records = type === 'properties'
      ? await this.prisma.property.findMany({ include: { owner: { select: { name: true, email: true, originCountry: true, currentCountry: true } }, district: true, taluka: true, village: true } })
      : type === 'payments'
        ? await this.prisma.payment.findMany({ include: { user: { select: { name: true, email: true } }, property: { select: { name: true } } } })
        : type === 'appointments'
          ? await this.prisma.appointment.findMany({ include: { property: { select: { name: true } }, nri: { select: { name: true, email: true } }, agent: { select: { name: true } } } })
          : await this.prisma.message.findMany({ where: { hidden: false }, include: { conversation: { include: { property: { select: { name: true } } } } } });
    const csv = this.toCsv(records);
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'EXPORT_CREATED', entity: type, after: { rows: records.length } });
    return csv;
  }

  private toCsv(records: object[]): string {
    if (!records.length) return '';
    const fields = Object.keys(records[0]);
    return [fields.map(escapeCsvCell).join(','), ...records.map((record) => fields.map((field) => escapeCsvCell((record as Record<string, unknown>)[field])).join(','))].join('\r\n');
  }
}
