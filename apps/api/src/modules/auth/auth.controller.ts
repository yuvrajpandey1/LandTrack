import { Body, Controller, Get, Ip, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { CurrentUser, MfaAllowed, Public, Roles, type AuthUser } from '../../common/auth';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';

const passwordSchema = z.string().min(10).regex(/[A-Za-z]/).regex(/\d/);
const registerNriSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  mobile: z.string().regex(/^\+[1-9]\d{7,14}$/),
  password: passwordSchema,
  originCountry: z.string().length(2).toUpperCase(),
  currentCountry: z.string().length(2).toUpperCase(),
  timeZone: z.string().min(1).max(80).default('Asia/Kolkata'),
  whatsappNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  whatsappOptIn: z.boolean().default(false),
  consents: z.object({ terms: z.literal(true), privacy: z.literal(true) })
});
const registerAgentSchema = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().email().max(254),
  mobile: z.string().regex(/^\+[1-9]\d{7,14}$/), password: passwordSchema,
  experienceYears: z.number().int().min(0).max(60).optional(),
  languages: z.array(z.string().min(1).max(60)).min(1).max(20),
  areasCovered: z.array(z.string().uuid()).min(1).max(100),
  consents: z.object({ terms: z.literal(true), privacy: z.literal(true) }),
  whatsappNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).optional()
});
const registerAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  mobile: z.string().regex(/^\+[1-9]\d{7,14}$/),
  password: passwordSchema,
  consents: z.object({ terms: z.literal(true), privacy: z.literal(true) }),
  setupCode: z.string().min(32).max(256)
});
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema
});
const otpSchema = z.object({ mobile: z.string().regex(/^\+[1-9]\d{7,14}$/) });
const verifyOtpSchema = otpSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timeZone: z.string().min(1).max(80).optional(),
  whatsappNumber: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional()
}).refine((value) => Object.keys(value).length > 0);
const consentSchema = z.object({ whatsapp: z.boolean() });

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/register/nri')
  registerNri(@Body(new ZodPipe(registerNriSchema)) body: z.infer<typeof registerNriSchema>) {
    return this.auth.registerNri(body);
  }

  @Public()
  @Post('auth/register/agent')
  registerAgent(@Body(new ZodPipe(registerAgentSchema)) body: z.infer<typeof registerAgentSchema>) {
    return this.auth.registerAgent(body);
  }

  @Public()
  @Post('auth/admin/setup-code')
  requestAdminSetupCode() {
    return this.auth.sendAdminSetupCode();
  }

  @Public()
  @Post('auth/register/admin')
  registerAdmin(@Body(new ZodPipe(registerAdminSchema)) body: z.infer<typeof registerAdminSchema>) {
    return this.auth.registerAdmin(body);
  }

  @Public()
  @Post('auth/otp/send')
  sendOtp(@Body(new ZodPipe(otpSchema)) body: z.infer<typeof otpSchema>, @Ip() ip: string) {
    return this.auth.sendOtp(body.mobile, ip);
  }

  @Public()
  @Post('auth/otp/verify')
  verifyOtp(@Body(new ZodPipe(verifyOtpSchema)) body: z.infer<typeof verifyOtpSchema>) {
    return this.auth.verifyOtp(body.mobile, body.code);
  }

  @Public()
  @Post('auth/login')
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body.email, body.password);
    if ('refreshToken' in result) this.setRefreshCookie(response, result.refreshToken);
    else response.clearCookie('landtrack_refresh', { path: '/api/v1/auth' });
    return result;
  }

  @Public()
  @Post('auth/refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.landtrack_refresh as string | undefined;
    if (!token) return this.auth.refresh('');
    const result = await this.auth.refresh(token);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('auth/logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.landtrack_refresh as string | undefined);
    response.clearCookie('landtrack_refresh', { path: '/api/v1/auth' });
    return { status: 'logged_out' };
  }

  @MfaAllowed()
  @Roles('ADMIN', 'AUDITOR')
  @ApiBearerAuth()
  @Post('auth/mfa/setup')
  setupMfa(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user);
  }

  @MfaAllowed()
  @Roles('ADMIN', 'AUDITOR')
  @ApiBearerAuth()
  @Post('auth/mfa/verify')
  async verifyMfa(@CurrentUser() user: AuthUser, @Body(new ZodPipe(codeSchema)) body: z.infer<typeof codeSchema>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verifyMfa(user, body.code);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Get('me')
  @ApiBearerAuth()
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user.sub);
  }

  @Patch('me')
  @ApiBearerAuth()
  updateProfile(@CurrentUser() user: AuthUser, @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>) {
    return this.auth.updateProfile(user.sub, body);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(passwordChangeSchema)) body: z.infer<typeof passwordChangeSchema>,
    @Res({ passthrough: true }) response: Response
  ) {
    const result = await this.auth.changePassword(user.sub, body.currentPassword, body.newPassword);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Patch('me/consents')
  @ApiBearerAuth()
  updateConsent(@CurrentUser() user: AuthUser, @Body(new ZodPipe(consentSchema)) body: z.infer<typeof consentSchema>) {
    return this.auth.setWhatsappConsent(user.sub, body.whatsapp);
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie('landtrack_refresh', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  }
}
