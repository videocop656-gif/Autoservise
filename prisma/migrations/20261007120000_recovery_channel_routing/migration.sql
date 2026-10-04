-- MCR-6 — recovery channel routing & SMS -> WhatsApp bridge (additive only).
--   * ChannelType / ConversationChannel 'SMS'  — outbound SMS recovery channel.
--   * call_interactions.recoveryChannel / recoveryRouteReason — route audit.
--   * channel_consents  — provider-neutral consent; no row = UNKNOWN (never permission).
--   * recovery_bridge_links — hashed one-tap bridge tokens (no PII in URLs).
-- Existing rows: all new columns NULL, no consent rows -> every business
-- starts with UNKNOWN consent (fail safe).

-- CreateEnum
CREATE TYPE "RecoveryRoute" AS ENUM ('WHATSAPP', 'SMS_BRIDGE');

-- CreateEnum
CREATE TYPE "ChannelConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');

-- AlterEnum
ALTER TYPE "ConversationChannel" ADD VALUE 'SMS';

-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'SMS';

-- AlterTable
ALTER TABLE "call_interactions" ADD COLUMN     "recoveryChannel" "RecoveryRoute",
ADD COLUMN     "recoveryRouteReason" TEXT;

-- CreateTable
CREATE TABLE "channel_consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "destinationE164" TEXT NOT NULL,
    "status" "ChannelConsentStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_bridge_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "callInteractionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_bridge_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_consents_tenantId_businessId_channel_destinationE16_key" ON "channel_consents"("tenantId", "businessId", "channel", "destinationE164");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_bridge_links_callInteractionId_key" ON "recovery_bridge_links"("callInteractionId");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_bridge_links_tokenHash_key" ON "recovery_bridge_links"("tokenHash");

-- CreateIndex
CREATE INDEX "recovery_bridge_links_tenantId_businessId_idx" ON "recovery_bridge_links"("tenantId", "businessId");

-- AddForeignKey
ALTER TABLE "channel_consents" ADD CONSTRAINT "channel_consents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_consents" ADD CONSTRAINT "channel_consents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_bridge_links" ADD CONSTRAINT "recovery_bridge_links_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_bridge_links" ADD CONSTRAINT "recovery_bridge_links_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_bridge_links" ADD CONSTRAINT "recovery_bridge_links_callInteractionId_fkey" FOREIGN KEY ("callInteractionId") REFERENCES "call_interactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK: open counter never negative.
ALTER TABLE "recovery_bridge_links" ADD CONSTRAINT "recovery_bridge_links_openCount_check" CHECK ("openCount" >= 0);
