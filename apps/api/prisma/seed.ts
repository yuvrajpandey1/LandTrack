import 'dotenv/config';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const settings: Record<string, Prisma.InputJsonValue> = {
  registrationChargeInr: 500,
  requireApprovalBeforeBooking: true,
  appointmentCancelCutoffHours: 2,
  slotDurationMin: 30,
  recordingEnabled: false,
  reminderHours: [24, 1],
  chatRetentionYears: 7,
  recordingRetentionMonths: 12
};

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_INITIAL_PASSWORD of at least 12 characters before seeding.');
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (!existingAdmin) {
    const mobile = process.env.ADMIN_MOBILE;
    if (!mobile || !/^\+[1-9]\d{7,14}$/.test(mobile)) {
      throw new Error('Set ADMIN_MOBILE to a unique E.164 phone number before creating the initial administrator.');
    }
    await prisma.user.create({
      data: {
        name: process.env.ADMIN_NAME?.trim() || 'LandTrack Administrator',
        email,
        mobile,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        mobileVerifiedAt: new Date()
      }
    });
  }

  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  const templates = Array.from({ length: 6 }, (_, index) => ({
    dayOfWeek: index + 1,
    startTime: '10:00',
    endTime: '18:00',
    durationMin: 30,
    capacity: 1
  }));
  for (const template of templates) {
    const exists = await prisma.slotTemplate.findFirst({ where: { dayOfWeek: template.dayOfWeek, startTime: template.startTime } });
    if (!exists) await prisma.slotTemplate.create({ data: template });
  }

  const district = await prisma.district.upsert({
    where: { name: 'Hyderabad' },
    update: {},
    create: { name: 'Hyderabad' }
  });
  const taluka = await prisma.taluka.upsert({
    where: { districtId_name: { districtId: district.id, name: 'Demo Mandal' } },
    update: {},
    create: { name: 'Demo Mandal', districtId: district.id }
  });
  await prisma.village.upsert({
    where: { talukaId_name: { talukaId: taluka.id, name: 'Demo Village' } },
    update: {},
    create: { name: 'Demo Village', talukaId: taluka.id }
  });
}

main()
  .catch((error: unknown) => {
    console.error('LandTrack database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
