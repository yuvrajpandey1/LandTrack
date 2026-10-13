CREATE TABLE "AdminSignupToken" (
    "id" TEXT NOT NULL DEFAULT 'initial',
    "tokenHash" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSignupToken_pkey" PRIMARY KEY ("id")
);

UPDATE "User" SET "status" = 'ACTIVE' WHERE "status" = 'PENDING_OTP';
