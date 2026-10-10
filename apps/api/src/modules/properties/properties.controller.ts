import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AreaUnit, Intent, OwnershipType, PropertyType, Role } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentUser, Public, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { PaymentsService } from '../payments/payments.service';
import { PropertiesService } from './properties.service';

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(PropertyType),
  surveyNumber: z.string().trim().min(1).max(80),
  districtId: z.string().uuid(), talukaId: z.string().uuid(), villageId: z.string().uuid(),
  address: z.string().max(300).optional(), landmark: z.string().max(160).optional(),
  latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
  area: z.number().positive().max(1_000_000), areaUnit: z.enum(AreaUnit),
  ownership: z.enum(OwnershipType), intent: z.enum(Intent).optional(),
  expectedPrice: z.number().positive().max(1_000_000_000_000).optional(),
  notes: z.string().max(2000).optional()
});
const documentSchema = z.object({
  kind: z.enum(['SALE_DEED', 'LAND_RECORD', 'TAX_RECEIPT', 'PHOTO', 'OTHER']),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024)
});
const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0);

@ApiTags('masters', 'properties')
@Controller()
export class PropertiesController {
  constructor(private readonly properties: PropertiesService, private readonly payments: PaymentsService) {}

  @Public()
  @Get('masters/countries')
  countries() { return this.properties.countries(); }

  @Public()
  @Get('masters/districts')
  districts() { return this.properties.districts(); }

  @Public()
  @Get('masters/talukas')
  talukas(@Query('districtId', new ParseUUIDPipe()) districtId: string) { return this.properties.talukas(districtId); }

  @Public()
  @Get('masters/villages')
  villages(@Query('talukaId', new ParseUUIDPipe()) talukaId: string) { return this.properties.villages(talukaId); }

  @Public()
  @Get('masters/property-types')
  propertyTypes() { return this.properties.propertyTypes(); }

  @Get('properties')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageSchema)) query: z.infer<typeof pageSchema>) {
    return this.properties.list(user.sub, user.role, query.page, query.pageSize);
  }

  @Post('properties')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>, @Req() request: Request, @Ip() ip: string) {
    return this.properties.create(body, user.sub, this.requestContext(user, request, ip));
  }

  @Get('properties/:id')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  @ApiBearerAuth()
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.properties.get(id, user.sub, user.role);
  }

  @Patch('properties/:id')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  update(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>, @Req() request: Request, @Ip() ip: string) {
    return this.properties.update(id, body, user.sub, user.role, ip, request.headers['user-agent']);
  }

  @Post('properties/:id/documents/presign')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  presign(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Body(new ZodPipe(documentSchema)) body: z.infer<typeof documentSchema>) {
    return this.properties.createDocumentUpload(id, user.sub, user.role, body);
  }

  @Post('properties/:id/documents/:docId/complete')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  completeDocument(@Param('id', new ParseUUIDPipe()) id: string, @Param('docId', new ParseUUIDPipe()) documentId: string, @CurrentUser() user: AuthUser, @Req() request: Request, @Ip() ip: string) {
    return this.properties.completeDocument(id, documentId, user.sub, user.role, ip, request.headers['user-agent']);
  }

  @Get('properties/:id/documents/:docId/url')
  @Roles(Role.NRI, Role.ADMIN, Role.AUDITOR)
  @ApiBearerAuth()
  documentUrl(@Param('id', new ParseUUIDPipe()) id: string, @Param('docId', new ParseUUIDPipe()) documentId: string, @CurrentUser() user: AuthUser, @Req() request: Request, @Ip() ip: string) {
    return this.properties.documentUrl(id, documentId, user.sub, user.role, ip, request.headers['user-agent']);
  }

  @Post('properties/:id/submit')
  @Roles(Role.NRI, Role.ADMIN)
  @ApiBearerAuth()
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser, @Req() request: Request, @Ip() ip: string) {
    return this.properties.requestSubmission(id, user.sub, user.role, { createOrder: (propertyId, ownerId) => this.payments.createOrder(propertyId, ownerId) }, ip, request.headers['user-agent']);
  }

  private requestContext(user: AuthUser, request: Request, ip: string) {
    return { role: user.role, ip, userAgent: request.headers['user-agent'] };
  }
}
