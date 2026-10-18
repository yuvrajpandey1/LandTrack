/// <reference types="jest" />
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, type AuthenticatedRequest } from './auth';

describe('JwtAuthGuard MFA enforcement', () => {
  const verifyAsync = jest.fn();
  const getAllAndOverride = jest.fn();
  const request = { headers: { authorization: 'Bearer test-token' } } as AuthenticatedRequest;
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  const guard = new JwtAuthGuard(
    { verifyAsync } as unknown as JwtService,
    { getAllAndOverride } as unknown as Reflector
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getAllAndOverride.mockReturnValue(false);
  });

  it('rejects legacy Admin access tokens until the user signs in and completes MFA', async () => {
    verifyAsync.mockResolvedValue({ sub: 'admin-id', role: 'ADMIN', email: 'admin@example.com' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'MFA_REAUTH_REQUIRED' }
    });
  });

  it('allows an MFA-pending token only on the MFA enrollment and verification endpoints', async () => {
    verifyAsync.mockResolvedValue({ sub: 'admin-id', role: 'ADMIN', email: 'admin@example.com', mfaPending: true });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a fully verified Admin session', async () => {
    verifyAsync.mockResolvedValue({ sub: 'admin-id', role: 'ADMIN', email: 'admin@example.com', mfaVerified: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.mfaVerified).toBe(true);
  });
});
