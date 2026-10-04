-- MCR-8A — production telephony (Kcell Virtual PBX). Additive only:
-- CallEventType.OBSERVED, CallEvent.providerStatus, CallInteraction.outcomeConflictAt,
-- TelephonyConnection (+ status enum). No secret is stored in the database.

-- CreateEnum
CREATE TYPE "TelephonyConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterEnum
ALTER TYPE "CallEventType" ADD VALUE 'OBSERVED';

-- AlterTable
ALTER TABLE "call_interactions" ADD COLUMN     "outcomeConflictAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "call_events" ADD COLUMN     "providerStatus" TEXT;

-- CreateTable
CREATE TABLE "telephony_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "TelephonyConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telephony_connections_tenantId_businessId_idx" ON "telephony_connections"("tenantId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_connections_businessId_provider_key" ON "telephony_connections"("businessId", "provider");

-- AddForeignKey
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_connections" ADD CONSTRAINT "telephony_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

