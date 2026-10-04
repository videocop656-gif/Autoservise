-- MCR-7B1 — production WhatsApp transport (Twilio pilot). Additive only.
--   * channel_connections.provider / senderE164 / routingKey (unique while
--     ACTIVE) — a live WhatsApp sender routes to exactly one business.
--   * ProviderDeliveryState 'READ' — WhatsApp read receipts.
--   * recovery_bridge_links.whatsappInboundAt — bridge attribution.
-- Existing rows: NULL everywhere (no Twilio connection yet; mock unchanged).

-- AlterEnum
ALTER TYPE "ProviderDeliveryState" ADD VALUE 'READ';

-- AlterTable
ALTER TABLE "channel_connections" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "routingKey" TEXT,
ADD COLUMN     "senderE164" TEXT;

-- AlterTable
ALTER TABLE "recovery_bridge_links" ADD COLUMN     "whatsappInboundAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_routingKey_key" ON "channel_connections"("routingKey");

