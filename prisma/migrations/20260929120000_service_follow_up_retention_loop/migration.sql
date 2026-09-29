-- Prompt 48 — Service Follow-up / Retention Loop.
--
-- Purely additive and backward-compatible: one new nullable column on
-- "services" (existing rows get NULL = "no repeat interval"), one new enum,
-- one new table. No existing column, constraint or row is changed or removed.
--
-- Hand-written (same approach as 20260916120000_retire_lead_model): the
-- shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- AlterTable
ALTER TABLE "services" ADD COLUMN "repeatIntervalDays" INTEGER;

-- A positive whole number of days, or NULL. Mirrors service.schemas.ts so
-- a bad value can never reach the table through any other path.
ALTER TABLE "services" ADD CONSTRAINT "services_repeatIntervalDays_positive" CHECK ("repeatIntervalDays" IS NULL OR "repeatIntervalDays" > 0);

-- CreateEnum
CREATE TYPE "ServiceFollowUpStatus" AS ENUM ('PENDING', 'CONTACTED', 'BOOKED', 'DISMISSED');

-- CreateTable
CREATE TABLE "service_follow_ups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceRecordId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "ServiceFollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "customerRequestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_follow_ups_serviceRecordId_key" ON "service_follow_ups"("serviceRecordId");

-- CreateIndex
CREATE INDEX "service_follow_ups_tenantId_businessId_status_dueAt_idx" ON "service_follow_ups"("tenantId", "businessId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "service_follow_ups_tenantId_businessId_customerId_status_du_idx" ON "service_follow_ups"("tenantId", "businessId", "customerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "service_follow_ups_tenantId_businessId_vehicleId_status_due_idx" ON "service_follow_ups"("tenantId", "businessId", "vehicleId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "service_follow_ups_customerRequestId_idx" ON "service_follow_ups"("customerRequestId");

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "service_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_follow_ups" ADD CONSTRAINT "service_follow_ups_customerRequestId_fkey" FOREIGN KEY ("customerRequestId") REFERENCES "customer_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
