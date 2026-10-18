/// <reference types="jest" />
import { AccountStatus, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';

describe('Admin and Auditor MFA login', () => {
  const findUnique = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const createRefreshToken = jest.fn();
  const rotateRefreshTokens = jest.fn();
  const updateUser = jest.fn();
  const findRefreshToken = jest.fn();
  const signAsync = jest.fn();
  const recordAudit = jest.fn();
  const transact = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));
  const prisma = {
    user: { findUnique, findUniqueOrThrow, update: updateUser },
    refreshToken: {
      create: createRefreshToken,
      findUnique: findRefreshToken,
      update: jest.fn(),
      updateMany: rotateRefreshTokens
    },
    $transaction: transact
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    { signAsync } as never,
    { record: recordAudit } as unknown as AuditService,
    {} as never
  );
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash('SecurePassword123');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    signAsync.mockResolvedValue('signed-jwt');
    recordAudit.mockResolvedValue(undefined);
    createRefreshToken.mockResolvedValue({});
    rotateRefreshTokens.mockResolvedValue({ count: 0 });
    updateUser.mockResolvedValue({});
  });

  it('issues only a restricted setup challenge for Admin password login', async () => {
    findUnique.mockResolvedValue({
      id: 'admin-id',
      name: 'Admin User',
      email: 'admin@example.com',
      mobile: '+919876543210',
      passwordHash,
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      mfaSecret: null,
      mfaEnabled: false
    });

    const result = await service.login('admin@example.com', 'SecurePassword123');

    expect(result).toMatchObject({ mfaRequired: true, mfaSetupRequired: true, accessToken: 'signed-jwt' });
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.ADMIN, mfaPending: true }),
      { expiresIn: '10m' }
    );
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('requires a valid TOTP before enabling MFA and issuing a full session', async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const user = {
      id: 'admin-id',
      name: 'Admin User',
      email: 'admin@example.com',
      mobile: '+919876543210',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      mfaSecret: secret,
      mfaEnabled: false
    };
    findUniqueOrThrow.mockResolvedValue(user);
    updateUser.mockResolvedValue({ ...user, mfaEnabled: true });
    const code = speakeasy.totp({ secret, encoding: 'base32' });

    const result = await service.verifyMfa(
      { sub: user.id, role: Role.ADMIN, email: user.email, mfaPending: true },
      code
    );

    expect(result).toMatchObject({ accessToken: 'signed-jwt', user: { role: Role.ADMIN } });
    expect(transact).toHaveBeenCalledTimes(1);
    expect(rotateRefreshTokens).toHaveBeenCalledWith({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(createRefreshToken).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: user.id, mfaVerified: true })
    });
  });

  it('rejects an invalid TOTP without creating a full session', async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    findUniqueOrThrow.mockResolvedValue({
      id: 'admin-id',
      name: 'Admin User',
      email: 'admin@example.com',
      mobile: '+919876543210',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      mfaSecret: secret,
      mfaEnabled: true
    });

    await expect(service.verifyMfa(
      { sub: 'admin-id', role: Role.ADMIN, email: 'admin@example.com', mfaPending: true },
      '000000'
    )).rejects.toMatchObject({ response: { code: 'MFA_INVALID' } });
    expect(transact).not.toHaveBeenCalled();
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('refuses legacy Admin refresh tokens without completed MFA', async () => {
    findRefreshToken.mockResolvedValue({
      userId: 'admin-id',
      tokenHash: 'hashed-token',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      mfaVerified: false,
      user: { id: 'admin-id', role: Role.ADMIN, email: 'admin@example.com', status: AccountStatus.ACTIVE, mfaEnabled: true }
    });

    await expect(service.refresh('refresh-token')).rejects.toMatchObject({
      response: { code: 'MFA_REAUTH_REQUIRED' }
    });
    expect(transact).not.toHaveBeenCalled();
  });
});
