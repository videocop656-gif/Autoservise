-- CreateEnum
CREATE TYPE "AiEscalationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiEscalationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "ai_escalations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "AiEscalationStatus" NOT NULL,
    "priority" "AiEscalationPriority" NOT NULL DEFAULT 'NORMAL',
    "reason" TEXT NOT NULL,
    "summary" TEXT,
    "assignedUserId" TEXT,
    "activeConversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ai_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_escalations_tenantId_businessId_idx" ON "ai_escalations"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "ai_escalations_tenantId_businessId_status_idx" ON "ai_escalations"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "ai_escalations_tenantId_businessId_priority_idx" ON "ai_escalations"("tenantId", "businessId", "priority");

-- CreateIndex
CREATE INDEX "ai_escalations_conversationId_idx" ON "ai_escalations"("conversationId");

-- CreateIndex
CREATE INDEX "ai_escalations_customerId_idx" ON "ai_escalations"("customerId");

-- CreateIndex
CREATE INDEX "ai_escalations_assignedUserId_idx" ON "ai_escalations"("assignedUserId");

-- CreateIndex
CREATE INDEX "ai_escalations_createdAt_idx" ON "ai_escalations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_escalations_tenantId_businessId_activeConversationId_key" ON "ai_escalations"("tenantId", "businessId", "activeConversationId");

-- AddForeignKey
ALTER TABLE "ai_escalations" ADD CONSTRAINT "ai_escalations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_escalations" ADD CONSTRAINT "ai_escalations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_escalations" ADD CONSTRAINT "ai_escalations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_escalations" ADD CONSTRAINT "ai_escalations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_escalations" ADD CONSTRAINT "ai_escalations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
