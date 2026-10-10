import { Injectable } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { toJsonInput } from './json';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    actorId?: string;
    actorRole?: Role;
    action: string;
    entity: string;
    entityId?: string;
    before?: object;
    after?: object;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...input,
        ...(input.before ? { before: toJsonInput(input.before) } : {}),
        ...(input.after ? { after: toJsonInput(input.after) } : {})
      }
    });
  }
}
