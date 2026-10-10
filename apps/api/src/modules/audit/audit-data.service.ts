import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Intent, PaymentStatus, Prisma, PropertyStatus, PropertyType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit.service';
import { escapeCsvCell } from '../../common/csv';
import { StorageService } from '../../providers/services/storage.service';
import type { AuthUser } from '../../common/auth';

interface RegisterFilters {
  page: number; pageSize: number; districtId?: string; talukaId?: string; villageId?: string;
  type?: PropertyType; intent?: Intent; status?: PropertyStatus; paymentStatus?: PaymentStatus;
  from?: string; to?: string; q?: string;
}

@Injectable()
export class AuditDataService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService) {}

  async summary() {
    const [propertiesByStatus, propertiesByIntent, paymentsByStatus, appointmentsByStatus, activeAgents, callsHeld, messagesExchanged] = await Promise.all([
      this.prisma.property.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.property.groupBy({ by: ['intent'], _count: { _all: true } }),
      this.prisma.payment.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.appointment.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count({ where: { role: 'AGENT', status: 'ACTIVE', agentProfile: { is: { approval: 'APPROVED' } } } }),
      this.prisma.call.count({ where: { actualStart: { not: null } } }),
      this.prisma.message.count()
    ]);
    return { propertiesByStatus, propertiesByIntent, paymentsByStatus, appointmentsByStatus, activeAgents, callsHeld, messagesExchanged };
  }

  async properties(filters: RegisterFilters) {
    const createdAt = filters.from || filters.to ? {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {})
    } : undefined;
    const where: Prisma.PropertyWhereInput = {
      ...(filters.districtId ? { districtId: filters.districtId } : {}),
      ...(filters.talukaId ? { talukaId: filters.talukaId } : {}),
      ...(filters.villageId ? { villageId: filters.villageId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.intent ? { intent: filters.intent } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.paymentStatus ? { payments: { some: { status: filters.paymentStatus } } } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: 'insensitive' as const } }, { surveyNumber: { contains: filters.q, mode: 'insensitive' as const } }] } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.property.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
        include: {
          owner: { select: { id: true, name: true, originCountry: true, currentCountry: true } },
          district: { select: { name: true } }, taluka: { select: { name: true } }, village: { select: { name: true } },
          payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, amount: true, currency: true, status: true, paidAt: true } }
        }
      }),
      this.prisma.property.count({ where })
    ]);
    return { items, total, page: filters.page, pageSize: filters.pageSize };
  }

  async property(id: string, actor: AuthUser) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true, mobile: true, originCountry: true, currentCountry: true } },
        district: true, taluka: true, village: true,
        documents: { select: { id: true, kind: true, mimeType: true, sizeBytes: true, scanStatus: true, uploadedAt: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        appointments: { orderBy: { startUtc: 'desc' }, include: { agent: { select: { id: true, name: true, email: true } }, call: true } }
      }
    });
    if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    const timeline = await this.prisma.auditLog.findMany({
      where: { entity: 'Property', entityId: id },
      orderBy: { at: 'asc' },
      select: { actorRole: true, action: true, before: true, after: true, at: true }
    });
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'AUDIT_PROPERTY_VIEWED', entity: 'Property', entityId: id });
    return { ...property, timeline };
  }

  async communications(id: string, actor: AuthUser) {
    const property = await this.prisma.property.findUnique({ where: { id }, select: { id: true } });
    if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    const [conversations, calls] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { propertyId: id },
        include: {
          participants: { include: { user: { select: { id: true, name: true, role: true } } } },
          messages: { where: { hidden: false }, orderBy: { sentAt: 'asc' }, include: { sender: { select: { id: true, name: true, role: true } }, attachment: { select: { id: true, mimeType: true, scanStatus: true } } } }
        }
      }),
      this.prisma.call.findMany({ where: { appointment: { propertyId: id } }, include: { appointment: { select: { startUtc: true, endUtc: true, mode: true, status: true } } } })
    ]);
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'TRANSCRIPT_VIEWED', entity: 'PropertyCommunication', entityId: id });
    return { conversations, calls };
  }

  async recordingUrl(id: string, actor: AuthUser) {
    const call = await this.prisma.call.findUnique({ where: { id } });
    if (!call) throw new NotFoundException({ code: 'CALL_NOT_FOUND', message: 'Call was not found.' });
    if (!call.recordingKey || !call.recordingConsentAll) throw new BadRequestException({ code: 'RECORDING_UNAVAILABLE', message: 'There is no consented recording for this call.' });
    const url = await this.storage.signDownload(call.recordingKey);
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'RECORDING_PLAYED', entity: 'Call', entityId: id });
    return { url, expiresInSeconds: 240 };
  }

  async search(query: string, actor: AuthUser) {
    const messages = await this.prisma.message.findMany({
      where: { hidden: false, body: { contains: query, mode: 'insensitive' } },
      orderBy: { sentAt: 'desc' }, take: 100,
      include: { sender: { select: { id: true, name: true } }, conversation: { include: { property: { select: { id: true, name: true } } } } }
    });
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'AUDIT_SEARCH', entity: 'Message', after: { resultCount: messages.length } });
    return messages;
  }

  async export(filters: RegisterFilters, actor: AuthUser): Promise<string> {
    const register = await this.properties({ ...filters, page: 1, pageSize: 1000 });
    const fields = ['id', 'name', 'type', 'surveyNumber', 'district', 'taluka', 'village', 'area', 'areaUnit', 'ownership', 'intent', 'status', 'ownerName', 'originCountry', 'currentCountry', 'createdAt'];
    const lines = register.items.map((item) => [
      item.id, item.name, item.type, item.surveyNumber, item.district.name, item.taluka.name, item.village.name, item.area.toString(),
      item.areaUnit, item.ownership, item.intent, item.status, item.owner.name, item.owner.originCountry, item.owner.currentCountry, item.createdAt.toISOString()
    ].map(escapeCsvCell).join(','));
    await this.audit.record({ actorId: actor.sub, actorRole: actor.role, action: 'EXPORT_CREATED', entity: 'AuditPropertyRegister', after: { rows: register.total } });
    return [fields.map(escapeCsvCell).join(','), ...lines].join('\r\n');
  }
}
