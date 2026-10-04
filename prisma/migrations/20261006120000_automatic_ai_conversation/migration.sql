-- MCR-5 — automatic AI conversation (additive only).
--   * businesses.aiAutoReplyEnabled  — kill switch, DEFAULT false: existing
--     businesses never start AI messaging because of this deploy.
--   * conversations.aiAutomation*    — durable per-conversation pause/resume.
--   * MessageSenderType 'AI'         — origin of automatic AI replies.
--   * ai_conversation_turns          — one row per eligible inbound message:
--     the durable AI-work marker and idempotency key.

-- CreateEnum
CREATE TYPE "AiTurnState" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiTurnDecision" AS ENUM ('REPLY', 'HANDOFF');

-- AlterEnum
ALTER TYPE "MessageSenderType" ADD VALUE 'AI';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "aiAutoReplyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "aiAutomationPausedAt" TIMESTAMP(3),
ADD COLUMN     "aiAutomationPausedReason" TEXT,
ADD COLUMN     "aiAutomationResumedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ai_conversation_turns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "state" "AiTurnState" NOT NULL DEFAULT 'PENDING',
    "decision" "AiTurnDecision",
    "reasonCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "replyMessageId" TEXT,
    "escalationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_turns_inboundMessageId_key" ON "ai_conversation_turns"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_turns_replyMessageId_key" ON "ai_conversation_turns"("replyMessageId");

-- CreateIndex
CREATE INDEX "ai_conversation_turns_tenantId_businessId_createdAt_idx" ON "ai_conversation_turns"("tenantId", "businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_conversation_turns_conversationId_createdAt_idx" ON "ai_conversation_turns"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_conversation_turns_state_createdAt_idx" ON "ai_conversation_turns"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_replyMessageId_fkey" FOREIGN KEY ("replyMessageId") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK: attempts are never negative.
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_attemptCount_check" CHECK ("attemptCount" >= 0);
