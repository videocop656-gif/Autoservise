-- MCR-7A — production SMS transport (Mobizon). Additive only.
--   * channel_deliveries.provider / providerDeliveryState / providerStatus /
--     providerStatusAt / providerSegments — carrier delivery after acceptance.
--   * provider_webhook_events — webhook idempotency ledger (no payload, no PII).
-- Existing rows: all new columns NULL (no provider report yet).

-- CreateEnum
CREATE TYPE "ProviderDeliveryState" AS ENUM ('ACCEPTED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'UNDELIVERED', 'EXPIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "channel_deliveries" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerDeliveryState" "ProviderDeliveryState",
ADD COLUMN     "providerSegments" INTEGER,
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "providerStatusAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channelDeliveryId" TEXT,
    "outcome" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_webhook_events_channelDeliveryId_idx" ON "provider_webhook_events"("channelDeliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_eventId_key" ON "provider_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "channel_deliveries_provider_externalMessageId_idx" ON "channel_deliveries"("provider", "externalMessageId");


-- CHECK: a segment count is positive when present.
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_providerSegments_check" CHECK ("providerSegments" IS NULL OR "providerSegments" > 0);
