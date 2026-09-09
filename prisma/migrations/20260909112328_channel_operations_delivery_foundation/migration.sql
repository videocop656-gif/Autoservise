-- CreateEnum
CREATE TYPE "ChannelDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "channel_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "ChannelDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_deliveries_tenantId_businessId_idx" ON "channel_deliveries"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "channel_deliveries_tenantId_businessId_status_idx" ON "channel_deliveries"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "channel_deliveries_messageId_idx" ON "channel_deliveries"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_deliveries_channelConnectionId_messageId_key" ON "channel_deliveries"("channelConnectionId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_deliveries_messageId_key" ON "channel_deliveries"("messageId");

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
