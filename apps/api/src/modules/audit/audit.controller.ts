import { BadRequestException, Controller, Get, Header, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Intent, PaymentStatus, PropertyStatus, PropertyType, Role } from '@prisma/client';
import { z } from 'zod';
import type { Response } from 'express';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AuditDataService } from './audit-data.service';

const filterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  districtId: z.string().uuid().optional(),
  talukaId: z.string().uuid().optional(),
  villageId: z.string().uuid().optional(),
  type: z.enum(PropertyType).optional(),
  intent: z.enum(Intent).optional(),
  status: z.enum(PropertyStatus).optional(),
  paymentStatus: z.enum(PaymentStatus).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z.string().max(120).optional()
});
const exportSchema = filterSchema.omit({ page: true, pageSize: true });

@ApiTags('audit')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.AUDITOR)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditDataService) {}

  @Get('summary')
  summary() { return this.audit.summary(); }

  @Get('properties')
  properties(@Query(new ZodPipe(filterSchema)) query: z.infer<typeof filterSchema>) {
    return this.audit.properties(query);
  }

  @Get('properties/:id')
  property(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.audit.property(id, user);
  }

  @Get('properties/:id/communications')
  communications(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.audit.communications(id, user);
  }

  @Get('calls/:id/recording-url')
  recordingUrl(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.audit.recordingUrl(id, user);
  }

  @Get('search')
  search(@Query('q') query: string, @CurrentUser() user: AuthUser) {
    const parsed = z.string().trim().min(2).max(120).safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: 'SEARCH_QUERY_INVALID', message: 'Search query must contain between 2 and 120 characters.' });
    return this.audit.search(parsed.data, user);
  }

  @Get('export')
  @Header('content-type', 'text/csv; charset=utf-8')
  async export(@Query(new ZodPipe(exportSchema)) query: z.infer<typeof exportSchema>, @CurrentUser() user: AuthUser, @Res() response: Response) {
    const csv = await this.audit.export({ ...query, page: 1, pageSize: 1000 }, user);
    response.setHeader('content-disposition', 'attachment; filename="landtrack-audit-properties.csv"');
    response.send(csv);
  }
}
