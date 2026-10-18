ALTER TABLE "Appointment"
ADD COLUMN "googleCalendarEventId" TEXT,
ADD COLUMN "googleMeetUrl" TEXT;

CREATE UNIQUE INDEX "Appointment_googleCalendarEventId_key"
ON "Appointment"("googleCalendarEventId");
