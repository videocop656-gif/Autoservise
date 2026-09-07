-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'RUB',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "business_working_hours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openTime" TEXT,
    "closeTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceFrom" DECIMAL(10,2),
    "priceTo" DECIMAL(10,2),
    "currency" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_working_hours_businessId_idx" ON "business_working_hours"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "business_working_hours_businessId_dayOfWeek_key" ON "business_working_hours"("businessId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "services_tenantId_idx" ON "services"("tenantId");

-- CreateIndex
CREATE INDEX "services_businessId_idx" ON "services"("businessId");

-- CreateIndex
CREATE INDEX "services_isActive_idx" ON "services"("isActive");

-- CreateIndex
CREATE INDEX "services_businessId_isActive_idx" ON "services"("businessId", "isActive");

-- AddForeignKey
ALTER TABLE "business_working_hours" ADD CONSTRAINT "business_working_hours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every pre-existing Business the 7 default working-hours
-- rows (Mon-Fri 09:00-18:00, Sat 10:00-15:00, Sun closed). Safe to re-run:
-- ON CONFLICT on the (businessId, dayOfWeek) unique constraint means a
-- Business that already has some/all of its 7 rows is left untouched for
-- those days. New Businesses created after this migration get their rows
-- from the application's registration transaction instead, not from here.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "business_working_hours" ("id", "businessId", "dayOfWeek", "isOpen", "openTime", "closeTime", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b."id", d.day, d.is_open, d.open_time, d.close_time, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "businesses" b
CROSS JOIN (
  VALUES
    ('MONDAY'::"DayOfWeek",    true,  '09:00', '18:00'),
    ('TUESDAY'::"DayOfWeek",   true,  '09:00', '18:00'),
    ('WEDNESDAY'::"DayOfWeek", true,  '09:00', '18:00'),
    ('THURSDAY'::"DayOfWeek",  true,  '09:00', '18:00'),
    ('FRIDAY'::"DayOfWeek",    true,  '09:00', '18:00'),
    ('SATURDAY'::"DayOfWeek",  true,  '10:00', '15:00'),
    ('SUNDAY'::"DayOfWeek",    false, NULL,    NULL)
) AS d(day, is_open, open_time, close_time)
ON CONFLICT ("businessId", "dayOfWeek") DO NOTHING;
