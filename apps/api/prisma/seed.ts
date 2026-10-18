import 'dotenv/config';
import { AccountStatus, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { hyderabadMandals } from './hyderabad-location-masters';
import nearbyLocationMasters from './telangana-nearby-location-masters.json';

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
  if (password && password.length < 12) {
    throw new Error('ADMIN_INITIAL_PASSWORD must be at least 12 characters.');
  }

  if (password && !email) {
    throw new Error('Set ADMIN_EMAIL when using ADMIN_INITIAL_PASSWORD to seed the initial administrator.');
  }

  if (!password && (!process.env.ADMIN_SIGNUP_CODE || process.env.ADMIN_SIGNUP_CODE.length < 32)) {
    throw new Error('Set ADMIN_INITIAL_PASSWORD or configure an ADMIN_SIGNUP_CODE of at least 32 characters before seeding.');
  }

  if (password && email) {
    const existingAdmin = await prisma.user.findUnique({ where: { email } });
    if (!existingAdmin) {
      const mobile = process.env.ADMIN_MOBILE;
      if (!mobile || !/^\+[1-9]\d{7,14}$/.test(mobile)) {
        throw new Error('Set ADMIN_MOBILE to a unique E.164 phone number before creating the initial administrator.');
      }
      await prisma.user.create({
        data: {
          name: process.env.ADMIN_NAME?.trim() || 'NRI Land Tracking System Administrator',
          email,
          mobile,
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          mobileVerifiedAt: new Date()
        }
      });
    }
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

  const locationDistricts = [
    { name: 'Hyderabad', mandals: hyderabadMandals },
    ...nearbyLocationMasters.districts
  ];
  for (const districtData of locationDistricts) {
    const district = await prisma.district.upsert({
      where: { name: districtData.name },
      update: { active: true },
      create: { name: districtData.name }
    });
    for (const mandalData of districtData.mandals) {
      const taluka = await prisma.taluka.upsert({
        where: { districtId_name: { districtId: district.id, name: mandalData.name } },
        update: { active: true },
        create: { name: mandalData.name, districtId: district.id }
      });
      for (const villageName of mandalData.villages) {
        await prisma.village.upsert({
          where: { talukaId_name: { talukaId: taluka.id, name: villageName } },
          update: { active: true },
          create: { name: villageName, talukaId: taluka.id }
        });
      }
    }
  }

  const district = await prisma.district.findUniqueOrThrow({ where: { name: 'Hyderabad' } });
  const demoMandal = await prisma.taluka.findUnique({
    where: { districtId_name: { districtId: district.id, name: 'Demo Mandal' } }
  });
  if (demoMandal) {
    await prisma.village.updateMany({ where: { talukaId: demoMandal.id }, data: { active: false } });
    await prisma.taluka.update({ where: { id: demoMandal.id }, data: { active: false } });
  }
}

main()
  .catch((error: unknown) => {
    console.error('NRI Land Tracking System database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
