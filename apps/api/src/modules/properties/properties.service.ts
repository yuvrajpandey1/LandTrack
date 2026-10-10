import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AreaUnit, Intent, OwnershipType, Prisma, PropertyStatus, PropertyType, Role } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../providers/services/storage.service';

type PropertyInput = {
  name: string; type: PropertyType; surveyNumber: string; districtId: string; talukaId: string;
  villageId: string; address?: string; landmark?: string; latitude?: number; longitude?: number; area: number; areaUnit: AreaUnit;
  ownership: OwnershipType; intent?: Intent; expectedPrice?: number; notes?: string;
};

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService
  ) {}

  async countries(): Promise<Array<{ code: string; name: string }>> {
    const countryCodes = ['AU','BR','CA','CN','DE','FR','GB','HK','ID','IN','IT','JP','MY','NZ','PH','QA','SA','SG','AE','US','ZA'];
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    return countryCodes.map((code) => ({ code, name: names.of(code) ?? code }));
  }

  districts() {
    return this.prisma.district.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  }

  talukas(districtId: string) {
    return this.prisma.taluka.findMany({ where: { districtId, active: true, district: { active: true } }, orderBy: { name: 'asc' }, select: { id: true, name: true, districtId: true } });
  }

  villages(talukaId: string) {
    return this.prisma.village.findMany({ where: { talukaId, active: true, taluka: { active: true, district: { active: true } } }, orderBy: { name: 'asc' }, select: { id: true, name: true, talukaId: true } });
  }

  propertyTypes() {
    return Object.values(PropertyType);
  }

  async list(userId: string, role: Role, page = 1, pageSize = 20) {
    const where = role === Role.ADMIN
      ? {}
      : role === Role.AGENT
        ? { appointments: { some: { agentId: userId } } }
        : { ownerId: userId };
    const [items, total] = await Promise.all([
      this.prisma.property.findMany({
        where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
        include: {
          owner: { select: { id: true, name: true, email: true, mobile: true } },
          district: true, taluka: true, village: true, documents: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
          appointments: { orderBy: { startUtc: 'desc' }, take: 5 }
        }
      }),
      this.prisma.property.count({ where })
    ]);
    return { items, total, page, pageSize };
  }

  async get(id: string, userId: string, role: Role) {
    const property = await this.prisma.property.findFirst({
      where: {
        id,
        ...(role === Role.ADMIN || role === Role.AUDITOR ? {} : role === Role.AGENT
          ? { appointments: { some: { agentId: userId } } }
          : { ownerId: userId })
      },
      include: {
        owner: { select: { id: true, name: true, email: true, mobile: true } },
        district: true, taluka: true, village: true, documents: true, payments: true,
        appointments: { include: { agent: { select: { id: true, name: true } } } }
      }
    });
    if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    return property;
  }

  async create(input: PropertyInput, ownerId: string, actor: { role: Role; ip?: string; userAgent?: string }) {
    await this.validateLocation(input);
    const property = await this.prisma.property.create({ data: this.propertyData(input, ownerId) });
    await this.audit.record({ actorId: ownerId, actorRole: actor.role, action: 'PROPERTY_CREATED', entity: 'Property', entityId: property.id, after: { status: property.status }, ip: actor.ip, userAgent: actor.userAgent });
    return property;
  }

  async update(id: string, input: Partial<PropertyInput>, userId: string, role: Role, ip?: string, userAgent?: string) {
    const current = await this.prisma.property.findUnique({ where: { id } });
    if (!current) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    if ((role !== Role.ADMIN && current.ownerId !== userId) || (current.status !== PropertyStatus.DRAFT && current.status !== PropertyStatus.REJECTED)) {
      throw new ForbiddenException({ code: 'PROPERTY_EDIT_DENIED', message: 'Only the owner can edit a draft or rejected property.' });
    }
    if (input.districtId || input.talukaId || input.villageId) {
      await this.validateLocation({
        districtId: input.districtId ?? current.districtId,
        talukaId: input.talukaId ?? current.talukaId,
        villageId: input.villageId ?? current.villageId
      });
    }
    const property = await this.prisma.property.update({
      where: { id },
      data: { ...input, ...(current.status === PropertyStatus.REJECTED ? { status: PropertyStatus.DRAFT, rejectionReason: null } : {}) }
    });
    await this.audit.record({ actorId: userId, actorRole: role, action: 'PROPERTY_UPDATED', entity: 'Property', entityId: id, before: { status: current.status }, after: { status: property.status }, ip, userAgent });
    return property;
  }

  async createDocumentUpload(propertyId: string, ownerId: string, role: Role, input: { kind: string; mimeType: string; sizeBytes: number }) {
    const property = await this.ownedProperty(propertyId, ownerId, role);
    if (property.status !== PropertyStatus.DRAFT && property.status !== PropertyStatus.REJECTED) {
      throw new BadRequestException({ code: 'PROPERTY_LOCKED', message: 'Documents can only be uploaded for a draft or rejected property.' });
    }
    const storageKey = this.storage.makeStorageKey(propertyId);
    const document = await this.prisma.document.create({
      data: { propertyId, storageKey, kind: input.kind, mimeType: input.mimeType, sizeBytes: input.sizeBytes, uploadedById: ownerId }
    });
    return { documentId: document.id };
  }

  async completeDocument(propertyId: string, documentId: string, userId: string, role: Role, ip?: string, userAgent?: string) {
    await this.ownedProperty(propertyId, userId, role);
    const document = await this.prisma.document.findFirst({ where: { id: documentId, propertyId } });
    if (!document) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found.' });
    if (document.scanStatus === 'CLEAN') return { id: document.id, scanStatus: 'CLEAN' };
    const { sha256 } = await this.storage.scanObject(document.storageKey, document.mimeType, document.sizeBytes);
    const updated = await this.prisma.document.update({ where: { id: documentId }, data: { sha256, scanStatus: 'CLEAN' } });
    await this.audit.record({ actorId: userId, actorRole: role, action: 'DOCUMENT_SCANNED', entity: 'Document', entityId: documentId, after: { scanStatus: updated.scanStatus }, ip, userAgent });
    return { id: updated.id, scanStatus: updated.scanStatus };
  }

  async uploadDocument(propertyId: string, documentId: string, userId: string, role: Role, mimeType: string, bytes: Buffer, ip?: string, userAgent?: string) {
    const property = await this.ownedProperty(propertyId, userId, role);
    if (property.status !== PropertyStatus.DRAFT && property.status !== PropertyStatus.REJECTED) {
      throw new BadRequestException({ code: 'PROPERTY_LOCKED', message: 'Documents can only be uploaded for a draft or rejected property.' });
    }
    const document = await this.prisma.document.findFirst({ where: { id: documentId, propertyId, uploadedById: role === Role.ADMIN ? undefined : userId } });
    if (!document) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document was not found.' });
    if (document.scanStatus === 'CLEAN') return { id: document.id, scanStatus: 'CLEAN' };
    if (mimeType !== document.mimeType || bytes.length !== document.sizeBytes) {
      throw new BadRequestException({ code: 'DOCUMENT_METADATA_MISMATCH', message: 'Uploaded document metadata does not match the upload request.' });
    }
    let sha256: string;
    try {
      ({ sha256 } = await this.storage.scanAndStore(document.storageKey, mimeType, bytes));
    } catch (error) {
      if (error instanceof BadRequestException) {
        await this.prisma.document.update({ where: { id: documentId }, data: { scanStatus: 'REJECTED' } });
        await this.audit.record({ actorId: userId, actorRole: role, action: 'DOCUMENT_REJECTED', entity: 'Document', entityId: documentId, after: { scanStatus: 'REJECTED' }, ip, userAgent });
      }
      throw error;
    }
    const updated = await this.prisma.document.update({ where: { id: documentId }, data: { sha256, scanStatus: 'CLEAN' } });
    await this.audit.record({ actorId: userId, actorRole: role, action: 'DOCUMENT_SCANNED', entity: 'Document', entityId: documentId, after: { scanStatus: updated.scanStatus }, ip, userAgent });
    return { id: updated.id, scanStatus: updated.scanStatus };
  }

  async documentUrl(propertyId: string, documentId: string, userId: string, role: Role, ip?: string, userAgent?: string) {
    await this.get(propertyId, userId, role);
    const document = await this.prisma.document.findFirst({ where: { id: documentId, propertyId, scanStatus: 'CLEAN' } });
    if (!document) throw new NotFoundException({ code: 'DOCUMENT_NOT_AVAILABLE', message: 'The scanned document is not available.' });
    const url = await this.storage.signDownload(document.storageKey);
    await this.audit.record({ actorId: userId, actorRole: role, action: 'DOC_VIEWED', entity: 'Document', entityId: documentId, ip, userAgent });
    return { url, expiresInSeconds: 240 };
  }

  async requestSubmission(id: string, userId: string, role: Role, payments: { createOrder: (id: string, userId: string) => Promise<object> }, ip?: string, userAgent?: string) {
    const property = await this.ownedProperty(id, userId, role);
    const cleanDocs = await this.prisma.document.count({ where: { propertyId: id, scanStatus: 'CLEAN' } });
    if (!cleanDocs) throw new BadRequestException({ code: 'CLEAN_DOCUMENT_REQUIRED', message: 'Upload at least one clean, scanned document before submitting.' });
    if (property.status !== PropertyStatus.DRAFT && property.status !== PropertyStatus.REJECTED && property.status !== PropertyStatus.PAYMENT_PENDING) {
      throw new BadRequestException({ code: 'INVALID_PROPERTY_TRANSITION', message: 'This property cannot be submitted in its current status.' });
    }
    await this.prisma.property.update({ where: { id }, data: { status: PropertyStatus.PAYMENT_PENDING, submittedAt: new Date() } });
    await this.audit.record({ actorId: userId, actorRole: role, action: 'PROPERTY_SUBMISSION_REQUESTED', entity: 'Property', entityId: id, ip, userAgent });
    return payments.createOrder(id, userId);
  }

  async listForAdmin(page = 1, pageSize = 20) {
    return this.list('', Role.ADMIN, page, pageSize);
  }

  async review(id: string, reviewerId: string, reviewerRole: Role, decision: 'APPROVED' | 'REJECTED', reason?: string, ip?: string, userAgent?: string) {
    const current = await this.prisma.property.findUnique({ where: { id } });
    if (!current) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    if (current.status !== PropertyStatus.SUBMITTED && current.status !== PropertyStatus.UNDER_REVIEW) {
      throw new BadRequestException({ code: 'INVALID_PROPERTY_TRANSITION', message: 'Only submitted properties can be reviewed.' });
    }
    if (decision === 'REJECTED' && !reason?.trim()) throw new BadRequestException({ code: 'REJECTION_REASON_REQUIRED', message: 'A reason is required when rejecting a property.' });
    const nextStatus = decision === 'APPROVED' ? PropertyStatus.APPROVED : PropertyStatus.REJECTED;
    const property = await this.prisma.property.update({
      where: { id }, data: {
        status: nextStatus, reviewedById: reviewerId, reviewedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? reason!.trim() : null
      }
    });
    await this.audit.record({ actorId: reviewerId, actorRole: reviewerRole, action: `PROPERTY_${decision}`, entity: 'Property', entityId: id, before: { status: current.status }, after: { status: nextStatus, reason }, ip, userAgent });
    return property;
  }

  private async validateLocation(input: Pick<PropertyInput, 'districtId' | 'talukaId' | 'villageId'>): Promise<void> {
    const village = await this.prisma.village.findFirst({
      where: { id: input.villageId, active: true, talukaId: input.talukaId, taluka: { active: true, districtId: input.districtId, district: { active: true } } }
    });
    if (!village) throw new BadRequestException({ code: 'INVALID_LOCATION', message: 'The village must belong to the selected active taluka and district.' });
  }

  private async ownedProperty(id: string, userId: string, role: Role) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException({ code: 'PROPERTY_NOT_FOUND', message: 'Property was not found.' });
    if (role !== Role.ADMIN && property.ownerId !== userId) throw new ForbiddenException({ code: 'PROPERTY_ACCESS_DENIED', message: 'You cannot access this property.' });
    return property;
  }

  private propertyData(input: PropertyInput, ownerId: string): Prisma.PropertyUncheckedCreateInput {
    return {
      ownerId, name: input.name.trim(), type: input.type, surveyNumber: input.surveyNumber.trim(),
      districtId: input.districtId, talukaId: input.talukaId, villageId: input.villageId,
      address: input.address, landmark: input.landmark, area: input.area, areaUnit: input.areaUnit,
      latitude: input.latitude, longitude: input.longitude,
      ownership: input.ownership, intent: input.intent, expectedPrice: input.expectedPrice,
      notes: input.notes, city: 'Hyderabad', state: 'Telangana'
    };
  }
}
