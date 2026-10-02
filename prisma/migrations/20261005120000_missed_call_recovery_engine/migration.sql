-- MCR-4 — Missed Call Recovery Engine.
--
-- Purely additive:
--   * four new CallRecoveryState values (CLAIMED, SENT, FAILED, SUPPRESSED) —
--     existing rows keep PENDING / NOT_ELIGIBLE / READY; ADD VALUE inside a
--     transaction is supported on PostgreSQL 12+ (Supabase runs 15) because no
--     statement here uses the new values;
--   * nullable recovery columns on call_interactions (+ attempt counter, 0);
--   * the Call → recovery Conversation / first Message links (RESTRICT /
--     SET NULL) and a unique recoveryMessageId (one call per message);
--   * the processor's scan index (recoveryState, outcomeDetectedAt).
-- DDL generated with `prisma migrate diff` against the live schema
-- (read-only), plus one CHECK at the end.
--
-- Hand-written (same approach as 20261004120000_service_pricing_business_location):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.


ALTER TYPE "CallRecoveryState" ADD VALUE 'CLAIMED';
ALTER TYPE "CallRecoveryState" ADD VALUE 'SENT';
ALTER TYPE "CallRecoveryState" ADD VALUE 'FAILED';
ALTER TYPE "CallRecoveryState" ADD VALUE 'SUPPRESSED';

-- AlterTable
ALTER TABLE "call_interactions" ADD COLUMN     "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryClaimedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryConversationId" TEXT,
ADD COLUMN     "recoveryFailureCode" TEXT,
ADD COLUMN     "recoveryMessageId" TEXT,
ADD COLUMN     "recoverySentAt" TIMESTAMP(3),
ADD COLUMN     "recoveryTemplateKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "call_interactions_recoveryMessageId_key" ON "call_interactions"("recoveryMessageId");

-- CreateIndex
CREATE INDEX "call_interactions_recoveryState_outcomeDetectedAt_idx" ON "call_interactions"("recoveryState", "outcomeDetectedAt");

-- CreateIndex
CREATE INDEX "call_interactions_recoveryConversationId_idx" ON "call_interactions"("recoveryConversationId");

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_recoveryConversationId_fkey" FOREIGN KEY ("recoveryConversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_recoveryMessageId_fkey" FOREIGN KEY ("recoveryMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "call_interactions" ADD CONSTRAINT "call_interactions_recoveryAttemptCount_nonnegative" CHECK ("recoveryAttemptCount" >= 0);
