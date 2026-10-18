/// <reference types="jest" />
import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmailService } from '../../providers/services/email.service';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';

describe('Admin setup code email flow', () => {
  const originalSetupEmail = process.env.ADMIN_SETUP_EMAIL;
  const send = jest.fn<Promise<void>, [string, string, string]>();
  const update = jest.fn();
  const updateMany = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const createUser = jest.fn();
  const recordAudit = jest.fn();
  const transaction = {
    adminSignupToken: { upsert: jest.fn(), findUniqueOrThrow, update, updateMany },
    user: { create: createUser },
    $queryRaw: jest.fn()
  };
  const prisma = {
    adminSignupToken: { updateMany },
    $transaction: jest.fn((callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction))
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    {} as never,
    { record: recordAudit } as unknown as AuditService,
    { send } as unknown as EmailService
  );

  beforeEach(() => {
    process.env.ADMIN_SETUP_EMAIL = 'adminlandtrack@gmail.com';
    jest.clearAllMocks();
    findUniqueOrThrow.mockResolvedValue({
      requestedAt: null,
      requestWindowStartedAt: null,
      requestCount: 0
    });
    createUser.mockResolvedValue({ id: 'new-admin-id' });
    recordAudit.mockResolvedValue(undefined);
    send.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalSetupEmail === undefined) delete process.env.ADMIN_SETUP_EMAIL;
    else process.env.ADMIN_SETUP_EMAIL = originalSetupEmail;
  });

  it('emails a random code to the configured address and stores only its hash', async () => {
    const result = await service.sendAdminSetupCode();
    const [recipient, subject, message] = send.mock.calls[0];
    const code = message.match(/code is:\n\n([A-Za-z0-9_-]{43})\n\n/)?.[1];

    expect(result.message).toContain('adminlandtrack@gmail.com');
    expect(recipient).toBe('adminlandtrack@gmail.com');
    expect(subject).toContain('setup code');
    expect(code).toBeDefined();
    expect(result.message).not.toContain(code);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'initial' },
      data: expect.objectContaining({
        tokenHash: createHash('sha256').update(code!).digest('hex'),
        failedAttempts: 0,
        requestCount: 1
      })
    }));
  });

  it('emails a setup code even when the database already has an administrator', async () => {
    await expect(service.sendAdminSetupCode()).resolves.toEqual({
      message: expect.stringContaining('adminlandtrack@gmail.com')
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('restricts additional administrator registration to the verified admin mailbox', async () => {
    await expect(service.registerAdmin({
      name: 'Another Admin',
      email: 'someone-else@example.com',
      mobile: '+15551234567',
      password: 'validpassword123',
      setupCode: 'unused-code-that-is-long-enough-for-the-endpoint'
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows the verified mailbox to create another administrator while one already exists', async () => {
    const setupCode = 'this-is-a-valid-email-issued-admin-setup-code';
    findUniqueOrThrow.mockResolvedValue({
      tokenHash: createHash('sha256').update(setupCode).digest('hex'),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      failedAttempts: 0
    });

    await expect(service.registerAdmin({
      name: 'LandTrack Administrator',
      email: 'adminlandtrack@gmail.com',
      mobile: '+919876543210',
      password: 'securePassword123',
      setupCode
    })).resolves.toEqual({ status: 'ACTIVE' });

    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'adminlandtrack@gmail.com', role: 'ADMIN' })
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consumedAt: expect.any(Date) })
    }));
  });

  it('rate-limits setup-code requests', async () => {
    findUniqueOrThrow.mockResolvedValue({
      requestedAt: new Date(),
      requestWindowStartedAt: new Date(),
      requestCount: 1
    });

    await expect(service.sendAdminSetupCode()).rejects.toBeInstanceOf(HttpException);
    expect(send).not.toHaveBeenCalled();
  });

  it('invalidates the code and surfaces an email delivery failure', async () => {
    send.mockRejectedValue(new Error('mail transport failure'));

    await expect(service.sendAdminSetupCode()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'initial', consumedAt: null }),
      data: expect.objectContaining({ consumedAt: expect.any(Date), requestedAt: null })
    }));
  });
});
