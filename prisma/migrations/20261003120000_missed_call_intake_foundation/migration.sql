-- MCR-2 — Missed Call Intake Foundation.
--
-- Purely additive: four enums and three new tables (business_phone_numbers,
-- call_interactions, call_events). No existing table, column or row is
-- touched. DDL generated with `prisma migrate diff` against the live schema
-- (read-only) plus two CHECK constraints at the end that Prisma's DSL can't
-- express.
--
-- Idempotency / routing invariants enforced by the database:
--   * business_phone_numbers."activePhoneE164" UNIQUE — at most one ACTIVE
--     owner of a public number across all tenants (nullable-column
--     technique, see schema.prisma), kept in lockstep with "isActive" by a CHECK;
--   * call_interactions ("provider", "providerCallId") UNIQUE — one record per call;
--   * call_events ("provider", "providerEventId") UNIQUE — each provider event
--     takes effect once, however often it is redelivered.
--
-- Hand-written (same approach as 20261002130000_business_phone_region):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('IN_PROGRESS', 'MISSED', 'ANSWERED');

-- CreateEnum
CREATE TYPE "CallRecoveryState" AS ENUM ('PENDING', 'NOT_ELIGIBLE', 'READY');

-- CreateEnum
CREATE TYPE "CallEventType" AS ENUM ('RINGING', 'ANSWERED', 'COMPLETED', 'MISSED');

-- CreateTable
CREATE TABLE "business_phone_numbers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activePhoneE164" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_phone_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_interactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessPhoneNumberId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "remotePhoneE164" TEXT,
    "customerId" TEXT,
    "outcome" "CallOutcome" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "firstEventReceivedAt" TIMESTAMP(3) NOT NULL,
    "lastEventReceivedAt" TIMESTAMP(3) NOT NULL,
    "outcomeDetectedAt" TIMESTAMP(3),
    "recoveryState" "CallRecoveryState" NOT NULL DEFAULT 'PENDING',
    "recoveryIneligibleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "callInteractionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" "CallEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_phone_numbers_activePhoneE164_key" ON "business_phone_numbers"("activePhoneE164");

-- CreateIndex
CREATE INDEX "business_phone_numbers_tenantId_businessId_idx" ON "business_phone_numbers"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "call_interactions_tenantId_businessId_createdAt_idx" ON "call_interactions"("tenantId", "businessId", "createdAt");

-- CreateIndex
CREATE INDEX "call_interactions_tenantId_businessId_recoveryState_idx" ON "call_interactions"("tenantId", "businessId", "recoveryState");

-- CreateIndex
CREATE INDEX "call_interactions_tenantId_businessId_remotePhoneE164_outco_idx" ON "call_interactions"("tenantId", "businessId", "remotePhoneE164", "outcomeDetectedAt");

-- CreateIndex
CREATE INDEX "call_interactions_customerId_idx" ON "call_interactions"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "call_interactions_provider_providerCallId_key" ON "call_interactions"("provider", "providerCallId");

-- CreateIndex
CREATE INDEX "call_events_callInteractionId_receivedAt_idx" ON "call_events"("callInteractionId", "receivedAt");

-- CreateIndex
CREATE INDEX "call_events_tenantId_businessId_idx" ON "call_events"("tenantId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "call_events_provider_providerEventId_key" ON "call_events"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "business_phone_numbers" ADD CONSTRAINT "business_phone_numbers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_phone_numbers" ADD CONSTRAINT "business_phone_numbers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "business_phone_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_callInteractionId_fkey" FOREIGN KEY ("callInteractionId") REFERENCES "call_interactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Business numbers are canonical E.164 (normalizePhone output).
ALTER TABLE "business_phone_numbers" ADD CONSTRAINT "business_phone_numbers_phoneE164_format" CHECK ("phoneE164" ~ '^\+[1-9][0-9]{6,14}$');

-- "activePhoneE164" mirrors "phoneE164" exactly while active and is NULL otherwise.
ALTER TABLE "business_phone_numbers" ADD CONSTRAINT "business_phone_numbers_active_mirror" CHECK (
  ("isActive" AND "activePhoneE164" = "phoneE164") OR (NOT "isActive" AND "activePhoneE164" IS NULL)
);
