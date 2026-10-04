import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { channelMessageRepository } from '../repositories/channelMessageRepository'
import { conversationRepository } from '../repositories/conversationRepository'
import { recordInboundMessage } from '../repositories/channelInboundRepository'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
import { channelTypeToConversationChannel } from '../channels/types'
import { resolveCustomerForInbound, linkCustomerIdentityBestEffort } from './channelCustomerService'
import { isAutoReplyChannel } from '../aiConversation/policy'
import { publishAiReplyJob, type AiReplyJobPublishStatus } from '../aiConversation/aiReplyJobs'
import { aiTurnRepository } from '../repositories/aiTurnRepository'

const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const

export interface ReceiveIncomingResult {
  conversationId: string
  messageId: string
  customerId: string | null
  /** True when this exact (channelConnectionId, externalMessageId) had already been processed — spec §"IDEMPOTENCY": never a second Message, always the original one returned. */
  duplicate: boolean
  conversationCreated: boolean
  conversationReopened: boolean
  /**
   * MCR-5 — present only when this message owes an automatic AI turn: the
   * outcome of publishing its durable job. PUBLISH_FAILED still leaves the
   * turn PENDING for reconciliation; a real provider webhook can answer 5xx
   * so the provider's retry re-publishes (duplicate → re-publish below).
   */
  aiReplyJob?: AiReplyJobPublishStatus
}

/**
 * Shared by the inbound pipeline below and by channelDeliveryService.ts's
 * outbound pipeline (Prompt 17) — exported rather than duplicated, since
 * both need the exact same "does this connection exist for this
 * tenant/business, and is it ACTIVE" check with the exact same error codes.
 * This is a non-behavior-changing refactor of an already-internal helper:
 * receiveIncoming() below calls it exactly as before.
 */
export async function resolveActiveConnection(ctx: AuthContext, channelConnectionId: string) {
  const connection = await channelConnectionRepository.findById(ctx.tenant.id, ctx.business.id, channelConnectionId)
  if (!connection) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  if (connection.status !== 'ACTIVE') {
    throw new ApiError(409, 'CHANNEL_INACTIVE', 'This channel connection is not active')
  }
  return connection
}

/** Re-fetches an already-processed inbound message by its ChannelMessage mapping — used both by the fast idempotency pre-check and by the race-recovery path below. ChannelMessage already stores externalConversationId redundantly (see schema.prisma), so the Conversation is found directly, without touching Message at all. */
async function loadDuplicateResult(ctx: AuthContext, channelConnectionId: string, externalMessageId: string): Promise<ReceiveIncomingResult | null> {
  const existing = await channelMessageRepository.findByConnectionAndExternalMessageId(ctx.tenant.id, ctx.business.id, channelConnectionId, externalMessageId)
  if (!existing) return null
  const conversation = await conversationRepository.findByChannelConnectionAndExternalId(
    ctx.tenant.id,
    ctx.business.id,
    channelConnectionId,
    existing.externalConversationId
  )
  if (!conversation) return null
  return {
    conversationId: conversation.id,
    messageId: existing.messageId,
    customerId: conversation.customerId,
    duplicate: true,
    conversationCreated: false,
    conversationReopened: false,
  }
}

/**
 * The full pipeline from spec §"INBOUND MESSAGE SERVICE":
 * ChannelConnection → validate active → normalize (adapter.parseIncoming)
 * → idempotency check → resolve customer identity → resolve/create/reopen
 * Conversation → create Message(INBOUND, CUSTOMER) → create ChannelMessage
 * mapping → update Conversation.lastMessageAt. Steps from "resolve/create
 * Conversation" through "update lastMessageAt" are one atomic transaction
 * (recordInboundMessage) — see channelInboundRepository.ts's own doc
 * comment for why. AI is never invoked here — no automatic response, no
 * escalation, exactly as scoped (spec §"NO AI CHANGES").
 *
 * `rawPayload` is deliberately typed `unknown`, not the foundation
 * endpoint's own `InboundChannelPayload` shape (Prompt 18) — this function
 * never reads a field off `rawPayload` directly, only ever passes it
 * straight into `adapter.parseIncoming()` (whose own signature already
 * takes `unknown`), so the previous, narrower type was never actually
 * required. Widening it is a pure type-level change with zero behavior
 * difference for the existing foundation caller (a Zod-validated
 * `InboundChannelPayload` is still perfectly assignable to `unknown`) and
 * is what lets the real Telegram webhook route (api/webhooks/telegram/)
 * pass a raw, differently-shaped Telegram Update straight through to this
 * same, otherwise-unmodified function.
 */
export async function receiveIncoming(
  ctx: AuthContext,
  channelConnectionId: string,
  rawPayload: unknown,
  // MCR-7B1 — e.g. a media-only WhatsApp message: stored, but no AI turn (an operator handles it).
  options: { suppressAiTurn?: boolean } = {}
): Promise<ReceiveIncomingResult> {
  requireRole(ctx, ...ANY_STAFF_ROLE)

  const connection = await resolveActiveConnection(ctx, channelConnectionId)
  const adapter = getChannelAdapter(connection.type, connection)
  const normalized = adapter.parseIncoming(rawPayload)

  if (!normalized.externalMessageId || !normalized.externalConversationId || !normalized.text) {
    throw new ApiError(400, 'INVALID_CHANNEL_PAYLOAD', 'Invalid channel payload')
  }

  // Fast idempotency pre-check — the common case (a genuine webhook retry)
  // never even reaches the transaction below.
  // MCR-5 — AI auto-replies apply only when the business switched them on AND
  // the channel is an auto-reply channel (WhatsApp; never Telegram). The
  // authoritative re-check happens again when the turn is claimed.
  const aiAutoReply = !options.suppressAiTurn && ctx.business.aiAutoReplyEnabled === true && isAutoReplyChannel(channelTypeToConversationChannel(connection.type))

  const existingDuplicate = await loadDuplicateResult(ctx, channelConnectionId, normalized.externalMessageId)
  if (existingDuplicate) {
    return aiAutoReply ? republishIfPending(ctx, existingDuplicate) : existingDuplicate
  }

  const resolution = await resolveCustomerForInbound(ctx, channelConnectionId, {
    externalCustomerId: normalized.externalCustomerId,
    customerPhone: normalized.customerPhone,
    customerName: normalized.customerName,
  })

  const recordArgs = {
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    channelConnectionId,
    channelType: channelTypeToConversationChannel(connection.type),
    externalConversationId: normalized.externalConversationId,
    externalMessageId: normalized.externalMessageId,
    text: normalized.text,
    sentAt: normalized.sentAt,
    customerId: resolution.customerId,
    aiAutoReply,
  }

  let recorded
  try {
    recorded = await recordInboundMessage(recordArgs)
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      throw err
    }
    // Spec §"IDEMPOTENCY RACE TEST": a genuine concurrent race lost a real
    // DB unique constraint — recordInboundMessage()'s own transaction has
    // already rolled back cleanly (see its own doc comment for why the
    // recovery can't safely happen inside that same transaction). Two
    // distinct races land here, both resolved without ever surfacing a raw
    // Prisma error or creating a duplicate row:
    //
    // 1. A true duplicate delivery of the SAME externalMessageId (the
    //    P2002 may be on ChannelMessage's or Conversation's constraint,
    //    depending on exact timing) — the winner's ChannelMessage row for
    //    THIS externalMessageId is already committed and visible (Postgres
    //    only reports the conflict once the colliding transaction has
    //    fully committed), so loadDuplicateResult() finds it directly.
    const winner = await loadDuplicateResult(ctx, channelConnectionId, normalized.externalMessageId)
    if (winner) return aiAutoReply ? republishIfPending(ctx, winner) : winner

    // 2. Two DIFFERENT first messages for the same brand-new external
    //    thread, racing to create the Conversation row — no ChannelMessage
    //    exists yet for THIS message's own externalMessageId (it belongs
    //    to the other message), so (1) above correctly finds nothing.
    //    Retrying the whole write once, in a fresh transaction, is now
    //    safe and sufficient: the winner's Conversation is durably
    //    committed, so this retry's own initial lookup finds it and
    //    proceeds to create THIS message's own Message + ChannelMessage
    //    normally — no further conflict, since its externalMessageId is
    //    genuinely unique.
    try {
      recorded = await recordInboundMessage(recordArgs)
    } catch (retryErr) {
      if (retryErr instanceof Prisma.PrismaClientKnownRequestError && retryErr.code === 'P2002') {
        const winnerAfterRetry = await loadDuplicateResult(ctx, channelConnectionId, normalized.externalMessageId)
        if (winnerAfterRetry) return aiAutoReply ? republishIfPending(ctx, winnerAfterRetry) : winnerAfterRetry
      }
      throw retryErr
    }
  }

  if (resolution.newIdentityToLink) {
    // resolution.customerId is always set here (see resolveCustomerForInbound's own contract) — never recorded.conversation.customerId, which only reflects the resolved customer for a NEWLY-created conversation; an existing conversation's own customerId is never overwritten by this pipeline.
    await linkCustomerIdentityBestEffort(ctx, channelConnectionId, resolution.customerId!, resolution.newIdentityToLink)
  }

  return {
    conversationId: recorded.conversation.id,
    messageId: recorded.message.id,
    customerId: recorded.conversation.customerId,
    duplicate: false,
    conversationCreated: recorded.wasConversationCreated,
    conversationReopened: recorded.wasConversationReopened,
    // MCR-5 — published only AFTER the message + turn committed; the AI itself
    // runs in the queue consumer, never on this request's critical path.
    ...(recorded.aiTurnCreated ? { aiReplyJob: await publishAiReplyJob(recorded.message.id) } : {}),
  }
}

/** A retried webhook for a message whose AI turn is still PENDING re-publishes its job (same idempotency key). */
async function republishIfPending(ctx: AuthContext, result: ReceiveIncomingResult): Promise<ReceiveIncomingResult> {
  const turn = await aiTurnRepository.findByInboundMessage(ctx.tenant.id, ctx.business.id, result.messageId)
  if (turn?.state !== 'PENDING') return result
  return { ...result, aiReplyJob: await publishAiReplyJob(result.messageId) }
}

// The pre-Prompt-17 "sendOutbound()" foundation function that lived here has
// been removed. It was never wired to an API route (see
// docs/DEVELOPMENT_ROADMAP.md's Prompt 16 entry: "outbound foundation" only)
// and had no delivery-state tracking, retry semantics, or concurrent-send
// protection at all — exactly the gap Prompt 17 exists to fill. Its
// replacement, channelDeliveryService.ts's sendMessageViaChannel(), covers
// the same "connection must be ACTIVE, Conversation must genuinely belong to
// this connection" checks (reusing resolveActiveConnection() above) plus the
// full ChannelDelivery lifecycle this stage requires. No client or frontend
// code ever called the old function, so this is not an observable behavior
// change for anything reachable through the API.
