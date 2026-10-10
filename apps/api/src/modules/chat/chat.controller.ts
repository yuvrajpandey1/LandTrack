import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { ChatService } from './chat.service';

const uploadSchema = z.object({ mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024) });
const messageSchema = z.object({ text: z.string().max(5000).optional(), attachmentId: z.string().uuid().optional() }).refine((value) => Boolean(value.text?.trim() || value.attachmentId));
const cursorSchema = z.object({ cursor: z.string().uuid().optional() });

@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  conversations(@CurrentUser() user: AuthUser) { return this.chat.conversations(user); }

  @Get('conversations/:id/messages')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN, Role.AUDITOR)
  messages(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodPipe(cursorSchema)) query: z.infer<typeof cursorSchema>, @CurrentUser() user: AuthUser) {
    return this.chat.messages(id, query.cursor, user, user.role === Role.AUDITOR);
  }

  @Post('conversations/:id/messages')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  send(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(messageSchema)) body: z.infer<typeof messageSchema>, @CurrentUser() user: AuthUser) {
    return this.chat.sendMessage(id, user, body);
  }

  @Post('conversations/:id/attachments/presign')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  presign(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(uploadSchema)) body: z.infer<typeof uploadSchema>, @CurrentUser() user: AuthUser) {
    return this.chat.presignAttachment(id, user, body.mimeType, body.sizeBytes);
  }

  @Post('conversations/:id/attachments/:attachmentId/complete')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  complete(@Param('id', new ParseUUIDPipe()) id: string, @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string, @CurrentUser() user: AuthUser) {
    return this.chat.completeAttachment(id, attachmentId, user);
  }

  @Get('conversations/:id/attachments/:attachmentId/url')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN, Role.AUDITOR)
  attachmentUrl(@Param('id', new ParseUUIDPipe()) id: string, @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string, @CurrentUser() user: AuthUser) {
    return this.chat.attachmentUrl(id, attachmentId, user);
  }

  @Post('conversations/:id/messages/:messageId/report')
  @Roles(Role.NRI, Role.AGENT, Role.ADMIN)
  report(@Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string, @CurrentUser() user: AuthUser) {
    return this.chat.report(id, messageId, user);
  }
}
