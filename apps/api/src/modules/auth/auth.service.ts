import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, AgentApproval, ConsentType, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit.service';
import { createTotpSecret, verifyTotp } from '../../common/totp';
import type { AuthUser } from '../../common/auth';

type RegisterNri = {
  name: string; email: string; mobile: string; password: string; originCountry: string;
  currentCountry: string; timeZone: string; whatsappNumber?: string; whatsappOptIn: boolean;
};
type RegisterAgent = {
  name: string; email: string; mobile: string; password: string; experienceYears?: number;
  languages: string[]; areasCovered: string[]; whatsappNumber?: string;
};

const otpHash = (code: string): string => createHmac('sha256', process.env.OTP_HASH_SECRET!).update(code).digest('hex');
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService
  ) {}

  async registerNri(input: RegisterNri): Promise<{ status: string }> {
    const user = await this.createUser(input, Role.NRI);
    await this.prisma.consent.createMany({
      data: [
        { userId: user.id, type: ConsentType.TERMS, version: '1.0' },
        { userId: user.id, type: ConsentType.PRIVACY, version: '1.0' },
        ...(input.whatsappOptIn ? [{ userId: user.id, type: ConsentType.WHATSAPP, version: '1.0' }] : [])
      ]
    });
    await this.audit.record({ action: 'NRI_ACCOUNT_REGISTERED', entity: 'User', entityId: user.id, after: { role: Role.NRI } });
    return { status: 'ACTIVE' };
  }

  async registerAgent(input: RegisterAgent): Promise<{ status: string; approval: AgentApproval }> {
    const uniqueAreas = new Set(input.areasCovered);
    const activeAreas = await this.prisma.district.count({ where: { id: { in: [...uniqueAreas] }, active: true } });
    if (activeAreas !== input.areasCovered.length) {
      throw new BadRequestException({ code: 'INVALID_AGENT_AREAS', message: 'Select distinct active districts for the agent service area.' });
    }
    const user = await this.createUser(input, Role.AGENT);
    await this.prisma.agentProfile.create({
      data: {
        userId: user.id,
        experienceYears: input.experienceYears,
        languages: input.languages,
        areasCovered: input.areasCovered
      }
    });
    await this.prisma.consent.createMany({
      data: [
        { userId: user.id, type: ConsentType.TERMS, version: '1.0' },
        { userId: user.id, type: ConsentType.PRIVACY, version: '1.0' }
      ]
    });
    await this.audit.record({ action: 'AGENT_ACCOUNT_REGISTERED', entity: 'User', entityId: user.id, after: { role: Role.AGENT, approval: AgentApproval.PENDING } });
    return { status: 'ACTIVE', approval: AgentApproval.PENDING };
  }

  async registerAdmin(input: { name: string; email: string; mobile: string; password: string; setupCode: string }): Promise<{ status: string }> {
    const configuredCode = process.env.ADMIN_SIGNUP_CODE;
    if (!configuredCode || !this.secretsMatch(configuredCode, input.setupCode)) {
      if (!configuredCode) {
        throw new ServiceUnavailableException({ code: 'ADMIN_SIGNUP_UNAVAILABLE', message: 'Administrator signup has not been configured.' });
      }
      throw new UnauthorizedException({ code: 'ADMIN_SETUP_CODE_INVALID', message: 'The administrator setup code is invalid or has already been used.' });
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const setupTokenHash = tokenHash(configuredCode);
    try {
      const user = await this.prisma.$transaction(async (transaction) => {
        await transaction.adminSignupToken.upsert({
          where: { id: 'initial' },
          create: { id: 'initial', tokenHash: setupTokenHash },
          update: {}
        });
        const adminCount = await transaction.user.count({
          where: { role: { in: [Role.ADMIN, Role.AUDITOR] } }
        });
        if (adminCount > 0) {
          throw new ConflictException({ code: 'ADMIN_ALREADY_EXISTS', message: 'Administrator signup is only available before an administrator account exists.' });
        }
        const consumed = await transaction.adminSignupToken.updateMany({
          where: { id: 'initial', tokenHash: setupTokenHash, consumedAt: null },
          data: { consumedAt: new Date() }
        });
        if (consumed.count !== 1) {
          throw new ConflictException({ code: 'ADMIN_SETUP_CODE_USED', message: 'The administrator setup code has already been used.' });
        }
        return transaction.user.create({
          data: {
            name: input.name.trim(),
            email: input.email.toLowerCase(),
            mobile: input.mobile,
            passwordHash,
            role: Role.ADMIN,
            status: AccountStatus.ACTIVE,
            consents: { create: [{ type: ConsentType.TERMS }, { type: ConsentType.PRIVACY }] }
          },
          select: { id: true }
        });
      });
      await this.audit.record({ action: 'ADMIN_ACCOUNT_REGISTERED', entity: 'User', entityId: user.id, after: { role: Role.ADMIN } });
      return { status: 'ACTIVE' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'ACCOUNT_EXISTS', message: 'An account already uses this email address or mobile number.' });
      }
      throw error;
    }
  }

  private async createUser(input: { name: string; email: string; mobile: string; password: string; whatsappNumber?: string; originCountry?: string; currentCountry?: string; timeZone?: string }, role: Role) {
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email: input.email.toLowerCase() }, { mobile: input.mobile }] }, select: { id: true } });
    if (existing) throw new ConflictException({ code: 'ACCOUNT_EXISTS', message: 'An account already uses this email or mobile number.' });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    return this.prisma.user.create({
      data: {
        name: input.name.trim(),
        email: input.email.toLowerCase(),
        mobile: input.mobile,
        passwordHash,
        role,
        status: AccountStatus.ACTIVE,
        whatsappNumber: input.whatsappNumber,
        originCountry: input.originCountry,
        currentCountry: input.currentCountry,
        timeZone: input.timeZone
      },
      select: { id: true, mobile: true }
    });
  }

  async sendOtp(mobile: string, ip?: string): Promise<{ status: string }> {
    const user = await this.prisma.user.findUnique({ where: { mobile }, select: { id: true, mobile: true, status: true } });
    if (!user || user.status !== AccountStatus.PENDING_OTP) {
      throw new UnauthorizedException({ code: 'OTP_UNAVAILABLE', message: 'No pending account verification exists for this mobile number.' });
    }
    await this.issueOtp(user.id, user.mobile, ip);
    return { status: 'OTP_SENT' };
  }

  private async issueOtp(userId: string, mobile: string, ip?: string): Promise<void> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const [latest, mobileCount, ipCount] = await Promise.all([
      this.prisma.otpChallenge.findFirst({ where: { userId, createdAt: { gte: hourAgo } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.otpChallenge.count({ where: { userId, createdAt: { gte: hourAgo } } }),
      ip ? this.prisma.otpChallenge.count({ where: { ip, createdAt: { gte: hourAgo } } }) : Promise.resolve(0)
    ]);
    if (latest && now.getTime() - latest.lastSentAt.getTime() < 60_000) {
      throw new HttpException({ code: 'OTP_RESEND_WAIT', message: 'Wait 60 seconds before requesting another OTP.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (mobileCount >= 5 || ipCount >= 10) {
      throw new HttpException({ code: 'OTP_RATE_LIMIT', message: 'The OTP request limit has been reached. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const usesTwilioVerify = process.env.SMS_PROVIDER === 'twilio_verify';
    const code = usesTwilioVerify ? undefined : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        userId,
        ip,
        codeHash: otpHash(code ?? randomUUID()),
        expiresAt: new Date(now.getTime() + (usesTwilioVerify ? 10 : 5) * 60_000)
      }
    });
    if (process.env.SMS_PROVIDER === 'fake') {
      if (process.env.NODE_ENV !== 'production') console.info(`Development OTP for ${mobile.replace(/.(?=.{3})/g, '*')}: ${code!}`);
      return;
    }
    if (usesTwilioVerify) {
      await this.requestTwilioVerification('Verifications', { To: mobile, Channel: 'sms' });
      return;
    }
    const response = await fetch(process.env.SMS_API_URL!, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.SMS_API_TOKEN!}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: mobile, message: `Your NRI Land Tracking System verification code is ${code}. It expires in 5 minutes.` })
    });
    if (!response.ok) throw new Error(`SMS provider rejected OTP delivery (${response.status}).`);
  }

  async verifyOtp(mobile: string, code: string): Promise<{ status: string }> {
    const user = await this.prisma.user.findUnique({ where: { mobile }, select: { id: true, status: true } });
    if (!user || user.status !== AccountStatus.PENDING_OTP) throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'The OTP is invalid or expired.' });
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      orderBy: { createdAt: 'desc' }
    });
    if (!challenge) throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'The OTP is invalid or expired.' });
    const valid = process.env.SMS_PROVIDER === 'twilio_verify'
      ? await this.verifyTwilioCode(mobile, code)
      : this.verifyLocalCode(challenge.codeHash, code);
    if (!valid) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException({ code: 'OTP_INVALID', message: 'The OTP is invalid or expired.' });
    }
    await this.prisma.$transaction([
      this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { status: AccountStatus.ACTIVE, mobileVerifiedAt: new Date() } })
    ]);
    await this.audit.record({ action: 'OTP_VERIFIED', entity: 'User', entityId: user.id });
    return { status: 'ACTIVE' };
  }

  private verifyLocalCode(codeHash: string, code: string): boolean {
    const actual = Buffer.from(codeHash);
    const expected = Buffer.from(otpHash(code));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private async verifyTwilioCode(mobile: string, code: string): Promise<boolean> {
    try {
      const result = await this.requestTwilioVerification('VerificationCheck', { To: mobile, Code: code });
      return result.status === 'approved';
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) return false;
      throw error;
    }
  }

  private async requestTwilioVerification(
    resource: 'Verifications' | 'VerificationCheck',
    values: { To: string; Channel?: 'sms'; Code?: string }
  ): Promise<{ status: string }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const username = apiKeySid ?? accountSid;
    const password = apiKeySid ? process.env.TWILIO_API_KEY_SECRET! : process.env.TWILIO_AUTH_TOKEN!;
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}/${resource}`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(values)
      }
    );
    if (!response.ok) {
      throw new HttpException(
        { code: 'SMS_PROVIDER_UNAVAILABLE', message: 'SMS verification could not be completed. Please try again later.' },
        response.status === 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY
      );
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string') {
      throw new HttpException(
        { code: 'SMS_PROVIDER_INVALID_RESPONSE', message: 'SMS verification provider returned an invalid response.' },
        HttpStatus.BAD_GATEWAY
      );
    }
    return { status: result.status };
  }

  async login(email: string, password: string): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    if (user.status !== AccountStatus.ACTIVE) throw new UnauthorizedException({ code: 'ACCOUNT_INACTIVE', message: 'This account is inactive. Contact NRI Land Tracking System support.' });
    return { ...(await this.createTokens(user.id, user.role, user.email)), user: this.publicUser(user) };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is incorrect.' });
    }
    if (await argon2.verify(user.passwordHash, newPassword)) {
      throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Choose a new password that is different from your current password.' });
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    const refreshToken = randomUUID() + randomUUID();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.refreshToken.create({
        data: { userId, tokenHash: tokenHash(refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) }
      })
    ]);
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, email: user.email }, { expiresIn: '15m' });
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'PASSWORD_CHANGED', entity: 'User', entityId: user.id });
    return { accessToken, refreshToken };
  }

  private secretsMatch(expected: string, actual: string): boolean {
    const expectedHash = Buffer.from(tokenHash(expected), 'hex');
    const actualHash = Buffer.from(tokenHash(actual), 'hex');
    return timingSafeEqual(expectedHash, actualHash);
  }

  async createTokens(userId: string, role: Role, email: string, mfaPending = false): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshToken = randomUUID() + randomUUID();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: tokenHash(refreshToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) }
    });
    const payload: AuthUser = { sub: userId, role, email, ...(mfaPending ? { mfaPending: true } : {}) };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: '15m' });
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: tokenHash(refreshToken) },
      include: { user: true }
    });
    if (!existing || existing.revokedAt || existing.expiresAt <= new Date() || existing.user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'The refresh token is invalid or expired.' });
    }
    const nextToken = randomUUID() + randomUUID();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } }),
      this.prisma.refreshToken.create({ data: { userId: existing.userId, tokenHash: tokenHash(nextToken), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000) } })
    ]);
    return {
      accessToken: await this.jwt.signAsync({
        sub: existing.userId, role: existing.user.role, email: existing.user.email
      }, { expiresIn: '15m' }),
      refreshToken: nextToken
    };
  }

  async logout(refreshToken?: string): Promise<{ status: string }> {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({ where: { tokenHash: tokenHash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return { status: 'logged_out' };
  }

  async setupMfa(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== Role.ADMIN && user.role !== Role.AUDITOR) throw new UnauthorizedException({ code: 'MFA_ROLE_REQUIRED', message: 'MFA setup is available only to Admin and Auditor accounts.' });
    const secret = createTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret, mfaEnabled: false } });
    return { secret, otpauthUrl: `otpauth://totp/NRI%20Land%20Tracking%20System:${encodeURIComponent(user.email)}?secret=${secret}&issuer=NRI%20Land%20Tracking%20System&algorithm=SHA1&digits=6&period=30` };
  }

  async verifyMfa(userId: string, code: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret || !verifyTotp(user.mfaSecret, code)) {
      throw new UnauthorizedException({ code: 'MFA_INVALID', message: 'The authenticator code is invalid.' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, email: user.email }, { expiresIn: '15m' });
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'MFA_ENABLED', entity: 'User', entityId: user.id });
    return { accessToken };
  }

  async getProfile(userId: string): Promise<object> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { consents: { where: { withdrawnAt: null } } } });
    return { ...this.publicUser(user), consents: user.consents.map((consent) => ({ type: consent.type, acceptedAt: consent.acceptedAt })) };
  }

  async updateProfile(userId: string, changes: { name?: string; timeZone?: string; whatsappNumber?: string | null }): Promise<object> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: changes,
      select: { id: true, name: true, email: true, mobile: true, whatsappNumber: true, role: true, status: true, originCountry: true, currentCountry: true, timeZone: true }
    });
    return user;
  }

  async setWhatsappConsent(userId: string, accepted: boolean): Promise<{ status: string }> {
    const active = await this.prisma.consent.findFirst({ where: { userId, type: ConsentType.WHATSAPP, withdrawnAt: null } });
    if (accepted && !active) await this.prisma.consent.create({ data: { userId, type: ConsentType.WHATSAPP, version: '1.0' } });
    if (!accepted && active) await this.prisma.consent.update({ where: { id: active.id }, data: { withdrawnAt: new Date() } });
    return { status: accepted ? 'opted_in' : 'opted_out' };
  }

  private publicUser(user: {
    id: string; name: string; email: string; mobile: string; role: Role; status: AccountStatus;
    originCountry: string | null; currentCountry: string | null; timeZone: string; whatsappNumber?: string | null
  }): object {
    return {
      id: user.id, name: user.name, email: user.email, mobile: user.mobile, role: user.role,
      status: user.status, originCountry: user.originCountry, currentCountry: user.currentCountry,
      timeZone: user.timeZone, whatsappNumber: user.whatsappNumber
    };
  }
}
