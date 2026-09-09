import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { channelMessageRepository } from '../repositories/channelMessageRepository'
import { conversationRepository } from '../repositories/conversationRepository'
import { messageRepository } from '../repositories/messageRepository'
import { recordInboundMessage } from '../repositories/channelInboundRepository'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
import { channelTypeToConversationChannel } from '../channels/types'
import { resolveCustomerForInbound, linkCustomerIdentityBestEffort } from './channelCustomerService'
import type { InboundChannelPayload } from '../validation/channel.schemas'

const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const

export interface ReceiveIncomingResult {
  conversationId: string
  messageId: string
  customerId: string | null
  /** True when this exact (channelConnectionId, externalMessageId) had already been processed — spec §"IDEMPOTENCY": never a second Message, always the original one returned. */
  duplicate: boolean
  conversationCreated: boolean
  conversationReopened: boolean
}

async function resolveActiveConnection(ctx: AuthContext, channelConnectionId: string) {
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
 */
export async function receiveIncoming(ctx: AuthContext, channelConnectionId: string, rawPayload: InboundChannelPayload): Promise<ReceiveIncomingResult> {
  requireRole(ctx, ...ANY_STAFF_ROLE)

  const connection = await resolveActiveConnection(ctx, channelConnectionId)
  const adapter = getChannelAdapter(connection.type)
  const normalized = adapter.parseIncoming(rawPayload)

  if (!normalized.externalMessageId || !normalized.externalConversationId || !normalized.text) {
    throw new ApiError(400, 'INVALID_CHANNEL_PAYLOAD', 'Invalid channel payload')
  }

  // Fast idempotency pre-check — the common case (a genuine webhook retry)
  // never even reaches the transaction below.
  const existingDuplicate = await loadDuplicateResult(ctx, channelConnectionId, normalized.externalMessageId)
  if (existingDuplicate) {
    return existingDuplicate
  }

  const resolution = await resolveCustomerForInbound(ctx, channelConnectionId, {
    externalCustomerId: normalized.externalCustomerId,
    customerPhone: normalized.customerPhone,
    customerName: normalized.customerName,
  })

  let recorded
  try {
    recorded = await recordInboundMessage({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      channelConnectionId,
      channelType: channelTypeToConversationChannel(connection.type),
      externalConversationId: normalized.externalConversationId,
      externalMessageId: normalized.externalMessageId,
      text: normalized.text,
      sentAt: normalized.sentAt,
      customerId: resolution.customerId,
    })
  } catch (err) {
    // Spec §"IDEMPOTENCY RACE TEST": a genuine concurrent duplicate loses
    // the DB's own unique constraint (P2002) here, never creating a
    // second Message — re-fetch and return the winner's row instead of
    // ever surfacing the raw Prisma error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await loadDuplicateResult(ctx, channelConnectionId, normalized.externalMessageId)
      if (winner) return winner
    }
    throw err
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
  }
}

/**
 * Outbound foundation (spec §"OUTBOUND FOUNDATION"/"OUTBOUND SECURITY") —
 * `conversationId` must belong to the requesting tenant/business AND be
 * linked to precisely this channel connection; an inactive connection
 * never sends. On a real (mock, here) send success, the message is
 * recorded through the EXISTING messageRepository.createAndTouchConversation()
 * — reusing the same infra every manually-sent staff message already uses
 * (spec §"ANALYTICS COMPATIBILITY": no second message-counting system) —
 * never on a failed send, so a failed adapter call never fabricates a
 * message that was never actually delivered.
 */
export async function sendOutbound(ctx: AuthContext, channelConnectionId: string, input: { conversationId: string; text: string }) {
  requireRole(ctx, ...ANY_STAFF_ROLE)

  const connection = await resolveActiveConnection(ctx, channelConnectionId)

  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, input.conversationId)
  if (!conversation || conversation.channelConnectionId !== channelConnectionId) {
    throw new ApiError(404, 'CHANNEL_CONVERSATION_NOT_FOUND', 'Conversation not found for this channel connection')
  }

  const adapter = getChannelAdapter(connection.type)
  const result = await adapter.sendMessage({ conversationExternalId: conversation.externalConversationId ?? '', text: input.text })
  if (!result.success) {
    throw new ApiError(502, 'CHANNEL_SEND_FAILED', 'Failed to send the message through this channel')
  }

  return messageRepository.createAndTouchConversation(ctx.tenant.id, ctx.business.id, {
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    senderType: 'STAFF',
    content: input.text,
  })
}
