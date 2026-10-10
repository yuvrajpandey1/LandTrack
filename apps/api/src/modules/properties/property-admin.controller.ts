import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { PrismaService } from '../../database/prisma.service';
import { ZodPipe } from '../../common/zod.pipe';
import { PropertiesService } from './properties.service';

const reviewSchema = z.object({ reason: z.string().trim().min(3).max(1000).optional() });
const paginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class PropertyAdminController {
  constructor(private readonly properties: PropertiesService, private readonly audit: AuditService, private readonly prisma: PrismaService) {}

  @Get('properties')
  list(@Query(new ZodPipe(paginationSchema)) page: z.infer<typeof paginationSchema>) {
    return this.properties.listForAdmin(page.page, page.pageSize);
  }

  @Post('properties/:id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Req() request: Request, @Ip() ip: string) {
    return this.properties.review(id, user.sub, user.role, 'APPROVED', undefined, ip, request.headers['user-agent']);
  }

  @Post('properties/:id/reject')
  reject(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>, @Req() request: Request, @Ip() ip: string) {
    return this.properties.review(id, user.sub, user.role, 'REJECTED', body.reason, ip, request.headers['user-agent']);
  }

  @Post('properties/:id/request-changes')
  requestChanges(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>, @Req() request: Request, @Ip() ip: string) {
    return this.properties.review(id, user.sub, user.role, 'REJECTED', body.reason, ip, request.headers['user-agent']);
  }

  @Get('audit-logs')
  async auditLogs(@CurrentUser() user: AuthUser, @Query('entity') entity?: string, @Query('entityId') entityId?: string) {
    await this.audit.record({ actorId: user.sub, actorRole: user.role, action: 'AUDIT_LOGS_VIEWED', entity: 'AuditLog' });
    return this.prisma.auditLog.findMany({
      where: { entity, entityId }, orderBy: { at: 'desc' }, take: 100
    });
  }
}
