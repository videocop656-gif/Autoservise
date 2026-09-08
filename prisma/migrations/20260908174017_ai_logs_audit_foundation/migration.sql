-- CreateEnum
CREATE TYPE "AiLogOperation" AS ENUM ('AI_ANALYZE', 'AI_TOOL_EXECUTION', 'AI_ESCALATION_CREATE', 'AI_ESCALATION_REUSE', 'AI_ESCALATION_CLAIM', 'AI_ESCALATION_RESOLVE', 'AI_ESCALATION_CANCEL');

-- CreateEnum
CREATE TYPE "AiLogOutcome" AS ENUM ('SUCCESS', 'ESCALATED', 'REUSED', 'FAILED', 'REJECTED', 'NO_ACTION');

-- CreateTable
CREATE TABLE "ai_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "escalationId" TEXT,
    "actorUserId" TEXT,
    "operation" "AiLogOperation" NOT NULL,
    "outcome" "AiLogOutcome" NOT NULL,
    "intent" TEXT,
    "confidence" DOUBLE PRECISION,
    "needsHuman" BOOLEAN,
    "reason" TEXT,
    "toolName" TEXT,
    "toolSuccess" BOOLEAN,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_logs_tenantId_businessId_idx" ON "ai_logs"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "ai_logs_tenantId_businessId_createdAt_idx" ON "ai_logs"("tenantId", "businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_logs_conversationId_createdAt_idx" ON "ai_logs"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_logs_escalationId_createdAt_idx" ON "ai_logs"("escalationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_logs_operation_createdAt_idx" ON "ai_logs"("operation", "createdAt");

-- CreateIndex
CREATE INDEX "ai_logs_outcome_createdAt_idx" ON "ai_logs"("outcome", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "ai_escalations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
