-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM', 'WHATSAPP', 'WEBSITE');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "channelConnectionId" TEXT,
ADD COLUMN     "externalConversationId" TEXT;

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'INACTIVE',
    "displayName" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "externalConversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_channel_identities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelConnectionId" TEXT NOT NULL,
    "externalCustomerId" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_connections_tenantId_businessId_idx" ON "channel_connections"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "channel_connections_tenantId_businessId_status_idx" ON "channel_connections"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_tenantId_businessId_type_externalAccoun_key" ON "channel_connections"("tenantId", "businessId", "type", "externalAccountId");

-- CreateIndex
CREATE INDEX "channel_messages_tenantId_businessId_idx" ON "channel_messages"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "channel_messages_externalConversationId_idx" ON "channel_messages"("externalConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_messages_channelConnectionId_externalMessageId_key" ON "channel_messages"("channelConnectionId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_messages_messageId_key" ON "channel_messages"("messageId");

-- CreateIndex
CREATE INDEX "customer_channel_identities_tenantId_businessId_idx" ON "customer_channel_identities"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "customer_channel_identities_customerId_idx" ON "customer_channel_identities"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_channel_identities_channelConnectionId_externalCus_key" ON "customer_channel_identities"("channelConnectionId", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channelConnectionId_externalConversationId_key" ON "conversations"("channelConnectionId", "externalConversationId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_identities" ADD CONSTRAINT "customer_channel_identities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_identities" ADD CONSTRAINT "customer_channel_identities_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_identities" ADD CONSTRAINT "customer_channel_identities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_channel_identities" ADD CONSTRAINT "customer_channel_identities_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "channel_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

