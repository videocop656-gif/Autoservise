import { Prisma, type AiConversationTurn, type Business, type Conversation, type Message } from '@prisma/client'
import { prisma } from '../db/prisma'
import { runInTransaction } from '../db/transaction'
import {
  AI_TURN_MAX_AGE_MINUTES,
  AI_TURN_MAX_ATTEMPTS,
  AI_TURN_NON_RETRYABLE_CODES,
  AI_TURN_STALE_CLAIM_SECONDS,
  isAutoReplyChannel,
  minutes,
  type AiPauseReason,
} from '../aiConversation/policy'

// ---------------------------------------------------------------------------
// MCR-5 — persistence of automatic AI turns. The ONLY writer of
// AiConversationTurn state and of the AI-origin reply Message.
//
// Everything that decides "may the AI act on this message now" happens under
// row locks, in one short transaction:
//   SELECT … FOR UPDATE on the turn          → duplicate deliveries / workers
//                                             of the same message queue here;
//   SELECT … FOR UPDATE on the conversation  → serializes AI work per
//                                             conversation AND against a staff
//                                             reply / pause (those update the
//                                             same row) and new inbound
//                                             messages (they touch lastMessageAt).
// Later transitions are compare-and-set on (state PROCESSING, attemptCount),
// so a stale or duplicate worker can never overwrite a newer outcome.
// ---------------------------------------------------------------------------

export type SkipReason =
  | 'AUTOMATION_DISABLED'
  | 'AUTOMATION_PAUSED'
  | 'CONVERSATION_CLOSED'
  | 'CHANNEL_NOT_SUPPORTED'
  | 'NOT_CUSTOMER_MESSAGE'
  | 'HUMAN_HANDLING'
  | 'HUMAN_TAKEOVER'
  | 'SUPERSEDED'
  | 'TOO_LATE'

export type ClaimResult =
  | { kind: 'CLAIMED'; turn: AiConversationTurn; conversation: Conversation; business: Business; inbound: Message }
  | { kind: 'SKIPPED'; reason: SkipReason | 'NOT_CLAIMABLE' }
  | { kind: 'BUSY' }
  | { kind: 'NOT_FOUND' }

/** Turns of the same conversation strictly after / before this one (createdAt, then id as a tie-break for the same millisecond). */
function newerThan(turn: Pick<AiConversationTurn, 'createdAt' | 'id'>): Prisma.AiConversationTurnWhereInput {
  return { OR: [{ createdAt: { gt: turn.createdAt } }, { createdAt: turn.createdAt, id: { gt: turn.id } }] }
}
function olderThan(turn: Pick<AiConversationTurn, 'createdAt' | 'id'>): Prisma.AiConversationTurnWhereInput {
  return { OR: [{ createdAt: { lt: turn.createdAt } }, { createdAt: turn.createdAt, id: { lt: turn.id } }] }
}

function isFresh(turn: Pick<AiConversationTurn, 'createdAt'>, now: Date): boolean {
  return turn.createdAt.getTime() >= now.getTime() - minutes(AI_TURN_MAX_AGE_MINUTES)
}

function isClaimable(turn: AiConversationTurn, now: Date): boolean {
  if (turn.state === 'PENDING') return true
  if (turn.state === 'FAILED') {
    return turn.attemptCount < AI_TURN_MAX_ATTEMPTS && !AI_TURN_NON_RETRYABLE_CODES.includes(turn.reasonCode ?? '')
  }
  if (turn.state === 'PROCESSING') return !!turn.claimedAt && turn.claimedAt.getTime() < now.getTime() - AI_TURN_STALE_CLAIM_SECONDS * 1000
  return false
}

/** The reconciliation work list: PENDING, retryable FAILED, abandoned PROCESSING — fresh only, oldest first. */
export function claimableTurnsWhere(now: Date): Prisma.AiConversationTurnWhereInput {
  return {
    createdAt: { gte: new Date(now.getTime() - minutes(AI_TURN_MAX_AGE_MINUTES)) },
    OR: [
      { state: 'PENDING' },
      { state: 'FAILED', attemptCount: { lt: AI_TURN_MAX_ATTEMPTS }, NOT: { reasonCode: { in: [...AI_TURN_NON_RETRYABLE_CODES] } } },
      { state: 'PROCESSING', claimedAt: { lt: new Date(now.getTime() - AI_TURN_STALE_CLAIM_SECONDS * 1000) } },
    ],
  }
}

async function lockConversation(tx: Prisma.TransactionClient, conversationId: string): Promise<Conversation | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "conversations" WHERE "id" = ${conversationId} FOR UPDATE`)
  if (!rows[0]) return null
  return tx.conversation.findUnique({ where: { id: conversationId } })
}

/**
 * Everything that makes an automatic message wrong right now, re-checked
 * under the conversation lock both at claim time and immediately before the
 * message is created. `handoffRedelivery` = re-sending this turn's own handoff
 * notice: the pause and the escalation are this turn's own doing then.
 */
async function blockingReason(
  tx: Prisma.TransactionClient,
  turn: AiConversationTurn,
  conversation: Conversation,
  business: Business,
  inbound: Message,
  opts: { handoffRedelivery: boolean }
): Promise<SkipReason | null> {
  if (!business.aiAutoReplyEnabled) return 'AUTOMATION_DISABLED'
  if (conversation.status !== 'OPEN') return 'CONVERSATION_CLOSED'
  if (!isAutoReplyChannel(conversation.channel) || !conversation.channelConnectionId) return 'CHANNEL_NOT_SUPPORTED'
  if (inbound.direction !== 'INBOUND' || inbound.senderType !== 'CUSTOMER' || !inbound.content.trim()) return 'NOT_CUSTOMER_MESSAGE'
  if (opts.handoffRedelivery) return null
  if (conversation.aiAutomationPausedAt) return 'AUTOMATION_PAUSED'
  const staffAfter = await tx.message.count({
    where: { conversationId: conversation.id, direction: 'OUTBOUND', senderType: 'STAFF', createdAt: { gte: inbound.createdAt } },
  })
  if (staffAfter > 0) return 'HUMAN_TAKEOVER'
  const activeEscalation = await tx.aiEscalation.count({ where: { conversationId: conversation.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } })
  if (activeEscalation > 0) return 'HUMAN_HANDLING'
  // A newer customer message makes this answer stale: its own turn answers
  // with the full context instead (coalescing — never two replies racing).
  const newer = await tx.aiConversationTurn.count({ where: { conversationId: conversation.id, ...newerThan(turn) } })
  if (newer > 0) return 'SUPERSEDED'
  return null
}

export interface FinalizeInput {
  decision: 'REPLY' | 'HANDOFF'
  content: string
  /** HANDOFF only: why automation is paused for the conversation. */
  pauseReason?: AiPauseReason
  /** Stored on the turn (safe code). */
  reasonCode?: string | null
}

export type FinalizeResult = { kind: 'CREATED'; messageId: string } | { kind: 'SKIPPED'; reason: SkipReason } | { kind: 'LOST_CLAIM' }

export const aiTurnRepository = {
  /** Called inside the inbound-message transaction (channelInboundRepository). */
  createForInbound(tx: Prisma.TransactionClient, data: { tenantId: string; businessId: string; conversationId: string; inboundMessageId: string }) {
    return tx.aiConversationTurn.create({ data: { ...data, state: 'PENDING' } })
  },

  /** Tenant-scoped state lookup (duplicate inbound webhook → re-publish while still PENDING). */
  findByInboundMessage(tenantId: string, businessId: string, inboundMessageId: string) {
    return prisma.aiConversationTurn.findFirst({ where: { tenantId, businessId, inboundMessageId } })
  },

  listClaimable(now: Date, limit: number) {
    return prisma.aiConversationTurn.findMany({ where: claimableTurnsWhere(now), orderBy: { createdAt: 'asc' }, take: limit, select: { inboundMessageId: true } })
  },

  claim(inboundMessageId: string, now: Date): Promise<ClaimResult> {
    return runInTransaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT "id" FROM "ai_conversation_turns" WHERE "inboundMessageId" = ${inboundMessageId} FOR UPDATE`
      )
      if (!locked[0]) return { kind: 'NOT_FOUND' }
      const turn = await tx.aiConversationTurn.findUniqueOrThrow({ where: { id: locked[0].id } })
      if (!isClaimable(turn, now)) return { kind: 'SKIPPED', reason: 'NOT_CLAIMABLE' }

      const conversation = await lockConversation(tx, turn.conversationId)
      if (!conversation) return { kind: 'NOT_FOUND' }
      const skip = (reason: SkipReason) =>
        tx.aiConversationTurn
          .update({ where: { id: turn.id }, data: { state: 'SKIPPED', reasonCode: reason, completedAt: now } })
          .then(() => ({ kind: 'SKIPPED' as const, reason }))

      if (!isFresh(turn, now)) return skip('TOO_LATE')
      // One AI turn at a time per conversation: another fresh claim → come back later.
      const busy = await tx.aiConversationTurn.count({
        where: {
          conversationId: conversation.id,
          id: { not: turn.id },
          state: 'PROCESSING',
          claimedAt: { gte: new Date(now.getTime() - AI_TURN_STALE_CLAIM_SECONDS * 1000) },
        },
      })
      if (busy > 0) return { kind: 'BUSY' }

      const business = await tx.business.findUniqueOrThrow({ where: { id: turn.businessId } })
      const inbound = await tx.message.findUniqueOrThrow({ where: { id: turn.inboundMessageId } })
      const handoffRedelivery = turn.decision === 'HANDOFF' && !!turn.replyMessageId
      const reason = await blockingReason(tx, turn, conversation, business, inbound, { handoffRedelivery })
      if (reason) return skip(reason)

      // Older unanswered turns of this conversation are covered by this one (their text is in its history).
      await tx.aiConversationTurn.updateMany({
        where: { conversationId: conversation.id, ...olderThan(turn), state: { in: ['PENDING', 'FAILED'] }, replyMessageId: null },
        data: { state: 'SKIPPED', reasonCode: 'SUPERSEDED', completedAt: now },
      })
      const claimed = await tx.aiConversationTurn.update({
        where: { id: turn.id },
        data: { state: 'PROCESSING', claimedAt: now, attemptCount: { increment: 1 }, reasonCode: null },
      })
      return { kind: 'CLAIMED', turn: claimed, conversation, business, inbound }
    })
  },

  /**
   * The irreversible step: re-checks everything under the locks (kill switch,
   * pause / staff takeover, newer message, still our claim) and only then
   * creates the ONE AI-origin message of this turn — linked to the turn in the
   * same transaction, so a retry re-delivers it and never generates another.
   * A HANDOFF also pauses the conversation here, durably.
   */
  finalize(turnId: string, attempt: number, input: FinalizeInput, now: Date): Promise<FinalizeResult> {
    return runInTransaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ai_conversation_turns" WHERE "id" = ${turnId} FOR UPDATE`)
      const turn = await tx.aiConversationTurn.findUniqueOrThrow({ where: { id: turnId } })
      if (turn.state !== 'PROCESSING' || turn.attemptCount !== attempt || turn.replyMessageId) return { kind: 'LOST_CLAIM' }
      const conversation = await lockConversation(tx, turn.conversationId)
      if (!conversation) return { kind: 'LOST_CLAIM' }
      const business = await tx.business.findUniqueOrThrow({ where: { id: turn.businessId } })
      const inbound = await tx.message.findUniqueOrThrow({ where: { id: turn.inboundMessageId } })
      const reason = await blockingReason(tx, turn, conversation, business, inbound, { handoffRedelivery: false })
      if (reason) {
        await tx.aiConversationTurn.update({ where: { id: turnId }, data: { state: 'SKIPPED', reasonCode: reason, completedAt: now } })
        return { kind: 'SKIPPED', reason }
      }
      const message = await tx.message.create({
        data: {
          tenantId: turn.tenantId,
          businessId: turn.businessId,
          conversationId: turn.conversationId,
          direction: 'OUTBOUND',
          senderType: 'AI',
          content: input.content,
          createdAt: now,
        },
      })
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: message.createdAt,
          ...(input.decision === 'HANDOFF' ? { aiAutomationPausedAt: now, aiAutomationPausedReason: input.pauseReason ?? 'AI_NEEDS_HUMAN' } : {}),
        },
      })
      await tx.aiConversationTurn.update({
        where: { id: turnId },
        data: { decision: input.decision, replyMessageId: message.id, reasonCode: input.reasonCode ?? null },
      })
      return { kind: 'CREATED', messageId: message.id }
    })
  },

  async setEscalation(turnId: string, escalationId: string): Promise<void> {
    await prisma.aiConversationTurn.update({ where: { id: turnId }, data: { escalationId } })
  },

  /** Compare-and-set from our own claim; false if another worker already moved it. */
  async transition(turnId: string, attempt: number, data: Prisma.AiConversationTurnUpdateManyMutationInput): Promise<boolean> {
    const result = await prisma.aiConversationTurn.updateMany({ where: { id: turnId, state: 'PROCESSING', attemptCount: attempt }, data })
    return result.count === 1
  },

  /** Consecutive automatic AI messages since the last human in the loop (staff message or explicit resume). */
  async countConsecutiveAiReplies(conversation: Pick<Conversation, 'id' | 'aiAutomationResumedAt'>): Promise<number> {
    const lastStaff = await prisma.message.findFirst({
      where: { conversationId: conversation.id, direction: 'OUTBOUND', senderType: 'STAFF' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    const since = [lastStaff?.createdAt, conversation.aiAutomationResumedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]
    return prisma.message.count({
      where: { conversationId: conversation.id, direction: 'OUTBOUND', senderType: 'AI', ...(since ? { createdAt: { gt: since } } : {}) },
    })
  },
}
