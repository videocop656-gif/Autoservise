import { Prisma, type CallInteraction } from '@prisma/client'
import { prisma } from '../db/prisma'
import { runInTransaction } from '../db/transaction'
import { recoveryFor } from '../telephony/callStateMachine'
import {
  NON_RETRYABLE_FAILURE_CODES,
  RECOVERY_ANTI_SPAM_WINDOW_MINUTES,
  RECOVERY_MAX_AGE_MINUTES,
  RECOVERY_MAX_ATTEMPTS,
  RECOVERY_STALE_CLAIM_SECONDS,
  minutes,
} from '../recovery/policy'

// ---------------------------------------------------------------------------
// MCR-4 — the recovery engine's persistence. The ONLY writer of the
// CLAIMED / SENT / FAILED / SUPPRESSED states and the recovery columns.
//
// Claiming is one short transaction per call:
//   SELECT … FOR UPDATE on the call row  → concurrent processors (and the
//     intake of a late webhook event) queue here, so exactly one wins;
//   re-check, under the lock, that the call is still claimable and still a
//     MISSED call (a late ANSWERED → NOT_ELIGIBLE, never sent);
//   pg_advisory_xact_lock on (tenant, business, caller phone) → two calls of
//     the same caller can't both pass the anti-spam check at once;
//   anti-spam check → SUPPRESSED, or CLAIMED.
// Every later transition is a compare-and-set on recoveryState = 'CLAIMED',
// so a stale or duplicate processor can never overwrite a newer outcome.
// ---------------------------------------------------------------------------

export type ClaimResult =
  | { kind: 'CLAIMED'; call: CallInteraction }
  | { kind: 'NOT_ELIGIBLE' | 'SUPPRESSED' | 'SKIPPED' }

/** The processor's work list: READY, retryable FAILED (fresh, under the cap), abandoned CLAIMED. Oldest miss first. */
export function claimableWhere(now: Date): Prisma.CallInteractionWhereInput {
  return {
    OR: [
      { recoveryState: 'READY' },
      {
        recoveryState: 'FAILED',
        recoveryAttemptCount: { lt: RECOVERY_MAX_ATTEMPTS },
        outcomeDetectedAt: { gte: new Date(now.getTime() - minutes(RECOVERY_MAX_AGE_MINUTES)) },
        NOT: { recoveryFailureCode: { in: [...NON_RETRYABLE_FAILURE_CODES] } },
      },
      { recoveryState: 'CLAIMED', updatedAt: { lt: new Date(now.getTime() - RECOVERY_STALE_CLAIM_SECONDS * 1000) } },
    ],
  }
}

function isClaimable(call: CallInteraction, now: Date): boolean {
  if (call.recoveryState === 'READY') return true
  if (call.recoveryState === 'FAILED') {
    return (
      call.recoveryAttemptCount < RECOVERY_MAX_ATTEMPTS &&
      !!call.outcomeDetectedAt &&
      call.outcomeDetectedAt.getTime() >= now.getTime() - minutes(RECOVERY_MAX_AGE_MINUTES) &&
      !NON_RETRYABLE_FAILURE_CODES.includes(call.recoveryFailureCode ?? '')
    )
  }
  if (call.recoveryState === 'CLAIMED') return call.updatedAt.getTime() < now.getTime() - RECOVERY_STALE_CLAIM_SECONDS * 1000
  return false
}

export const callRecoveryRepository = {
  listClaimable(now: Date, limit: number) {
    return prisma.callInteraction.findMany({
      where: claimableWhere(now),
      orderBy: { outcomeDetectedAt: 'asc' },
      take: limit,
      select: { id: true },
    })
  },

  claim(callId: string, now: Date): Promise<ClaimResult> {
    return runInTransaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "call_interactions" WHERE "id" = ${callId} FOR UPDATE`)
      if (!locked[0]) return { kind: 'SKIPPED' }
      const call = await tx.callInteraction.findUniqueOrThrow({ where: { id: callId } })
      if (!isClaimable(call, now)) return { kind: 'SKIPPED' }

      // Authoritative re-check under the lock: a call answered meanwhile (late
      // ANSWERED event), an outbound call or one without a caller number is
      // never recovered.
      const eligibility = recoveryFor(call)
      if (eligibility.recoveryState !== 'READY') {
        await tx.callInteraction.update({
          where: { id: callId },
          data: { recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: eligibility.recoveryIneligibleReason },
        })
        return { kind: 'NOT_ELIGIBLE' }
      }

      const detectedAt = call.outcomeDetectedAt ?? call.firstEventReceivedAt
      if (detectedAt.getTime() < now.getTime() - minutes(RECOVERY_MAX_AGE_MINUTES)) {
        await tx.callInteraction.update({ where: { id: callId }, data: { recoveryState: 'SUPPRESSED', recoveryIneligibleReason: 'TOO_LATE' } })
        return { kind: 'SUPPRESSED' }
      }

      // One caller at a time per business for the anti-spam decision.
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
      // Prisma cannot deserialize as a result row (found live on Supabase).
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${call.tenantId}:${call.businessId}:${call.remotePhoneE164}`}))`
      )
      const windowStart = new Date(detectedAt.getTime() - minutes(RECOVERY_ANTI_SPAM_WINDOW_MINUTES))
      const recent = await tx.callInteraction.count({
        where: {
          tenantId: call.tenantId,
          businessId: call.businessId,
          remotePhoneE164: call.remotePhoneE164,
          id: { not: call.id },
          OR: [
            { recoveryState: 'SENT', recoverySentAt: { gte: windowStart } },
            { recoveryState: 'CLAIMED', recoveryClaimedAt: { gte: windowStart } },
          ],
        },
      })
      if (recent > 0) {
        await tx.callInteraction.update({ where: { id: callId }, data: { recoveryState: 'SUPPRESSED', recoveryIneligibleReason: 'ANTI_SPAM' } })
        return { kind: 'SUPPRESSED' }
      }

      const claimed = await tx.callInteraction.update({
        where: { id: callId },
        data: {
          recoveryState: 'CLAIMED',
          // The FIRST claim is the latency milestone; later attempts keep it.
          recoveryClaimedAt: call.recoveryClaimedAt ?? now,
          recoveryAttemptCount: { increment: 1 },
          recoveryFailureCode: null,
        },
      })
      return { kind: 'CLAIMED', call: claimed }
    })
  },

  /**
   * Locks the claimed call and re-checks it is still CLAIMED and still MISSED
   * immediately before the first message is created and sent; runs `write`
   * in the same transaction. Returns false (nothing written) otherwise — a
   * call answered meanwhile is moved to NOT_ELIGIBLE here.
   */
  async withClaimedMissedCall(callId: string, write: (tx: Prisma.TransactionClient, call: CallInteraction) => Promise<void>): Promise<'OK' | 'ANSWERED' | 'LOST_CLAIM'> {
    return runInTransaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "call_interactions" WHERE "id" = ${callId} FOR UPDATE`)
      const call = await tx.callInteraction.findUniqueOrThrow({ where: { id: callId } })
      if (call.recoveryState !== 'CLAIMED') return 'LOST_CLAIM'
      if (call.outcome !== 'MISSED') {
        await tx.callInteraction.update({
          where: { id: callId },
          data: { recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: recoveryFor(call).recoveryIneligibleReason ?? 'ANSWERED' },
        })
        return 'ANSWERED'
      }
      await write(tx, call)
      return 'OK'
    })
  },

  /** Compare-and-set from CLAIMED; false if another processor already moved it. */
  async transitionFromClaimed(callId: string, data: Prisma.CallInteractionUpdateManyMutationInput & { recoveryConversationId?: string; recoveryMessageId?: string }, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = tx ?? prisma
    const result = await db.callInteraction.updateMany({ where: { id: callId, recoveryState: 'CLAIMED' }, data })
    return result.count === 1
  },
}
