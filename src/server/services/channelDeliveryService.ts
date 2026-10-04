import type { ChannelConnection, ChannelDelivery, Message } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { messageRepository } from '../repositories/messageRepository'
import { channelDeliveryRepository } from '../repositories/channelDeliveryRepository'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { resolveActiveConnection } from './channelMessageService'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
import { isWhatsAppSessionOpen } from '../channels/customerServiceWindow'
import type { NormalizedOutboundMessage } from '../channels/types'
import { channelTypeToConversationChannel } from '../channels/types'
import { toChannelDeliveryDto, type ChannelDeliveryDto } from '../lib/dto'

// Same operational-access precedent already established for the inbound/
// outbound channel pipeline (channelMessageService.ts's ANY_STAFF_ROLE) and
// explicitly permitted by Prompt 17 spec §19: "Manager — может выполнять
// operational outbound send, если это соответствует текущей permission
// model каналов" — it does, since manager already has this level of access
// to receiveIncoming(). Channel *management* (create/edit/activate/
// deactivate a ChannelConnection, channelConnectionService.ts) stays a
// separate, stricter MANAGING_ROLES-only concern, untouched by this file.
const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const

// A short, safe cap — mirrors channelConnectionService.ts's
// MAX_CONFIG_VALUE_LENGTH convention. Every string stored here already
// comes from this codebase's own mock adapter (never a raw provider
// payload), but the cap is kept anyway as a second, independent defense
// against ever persisting or returning an unbounded string.
const MAX_ERROR_MESSAGE_LENGTH = 300

function safeErrorMessage(message: string | undefined, fallback: string): string {
  const value = message && message.trim().length > 0 ? message : fallback
  return value.slice(0, MAX_ERROR_MESSAGE_LENGTH)
}

/**
 * The full outbound pipeline (Prompt 17 spec §5): Message → validate
 * ownership → validate Conversation → validate channel match → validate
 * ChannelConnection ACTIVE → get/create ChannelDelivery → attempt
 * adapter.sendMessage() → SUCCESS/FAILURE → update ChannelDelivery.
 *
 * Every rejection before "get/create ChannelDelivery" happens WITHOUT ever
 * creating a ChannelDelivery row (spec §20: "Не создавать Delivery при
 * заведомо inactive connection" — generalized here to every precondition
 * failure, not just inactivity).
 *
 * `messageId` is validated to belong to the exact Conversation that is
 * itself linked to `channelConnectionId` — never just "same tenant" — so a
 * client can never smuggle another conversation's, another channel's, or
 * another tenant's message id through this endpoint (spec §4, §26). Every
 * such mismatch is reported as the same safe `MESSAGE_NOT_FOUND` 404,
 * regardless of the underlying reason, so the response never leaks whether
 * a message exists somewhere else.
 */
export async function sendMessageViaChannel(ctx: AuthContext, channelConnectionId: string, messageId: string): Promise<ChannelDeliveryDto> {
  requireRole(ctx, ...ANY_STAFF_ROLE)

  // Throws CHANNEL_NOT_FOUND (404) / CHANNEL_INACTIVE (409) — never creates
  // a ChannelDelivery row for an inactive or nonexistent connection.
  const connection = await resolveActiveConnection(ctx, channelConnectionId)

  const message = await messageRepository.findById(ctx.tenant.id, ctx.business.id, messageId)
  if (!message) {
    throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Message not found')
  }
  if (message.direction !== 'OUTBOUND' || message.senderType !== 'STAFF') {
    throw new ApiError(409, 'MESSAGE_NOT_OUTBOUND', 'Only an outbound staff message can be sent through a channel')
  }

  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, message.conversationId)
  if (!conversation) {
    // Defensive only — a tenant-scoped Message always has a tenant-scoped
    // Conversation behind it by construction (Message.conversation is a
    // required, Cascade-owned relation). Never actually reachable through
    // normal use.
    throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found')
  }
  if (conversation.channelConnectionId !== channelConnectionId) {
    // Covers every "wrong message" shape in one check: a message from
    // another conversation, another channel connection, a manually-created
    // (MANUAL/PHONE/OTHER) conversation with no channel connection at all,
    // or — since messageRepository.findById() is already tenant-scoped —
    // another tenant entirely. Reported identically to a genuinely missing
    // message so the response never distinguishes "exists elsewhere" from
    // "doesn't exist" (spec §26).
    throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Message not found')
  }
  if (channelTypeToConversationChannel(connection.type) !== conversation.channel) {
    // Defense-in-depth (spec §21) — structurally unreachable through the
    // normal inbound/create pipeline today (a Conversation's channel and
    // channelConnectionId are always set together, from the same
    // connection's own type), but explicitly required by the spec and kept
    // as a real, tested guard rather than an assumption.
    throw new ApiError(409, 'CHANNEL_TYPE_MISMATCH', 'This conversation belongs to a different channel type')
  }
  if (!conversation.externalConversationId) {
    throw new ApiError(409, 'EXTERNAL_CONVERSATION_NOT_FOUND', 'This conversation has no external channel thread to send to')
  }

  const attempt = await attemptDelivery(ctx.tenant.id, ctx.business.id, connection, conversation.externalConversationId, message)
  if (attempt.status === 'IN_PROGRESS' || attempt.status === 'UNCERTAIN') {
    throw new ApiError(409, 'DELIVERY_IN_PROGRESS', 'This message is already being sent')
  }
  if (attempt.status === 'FAILED') {
    throw new ApiError(502, attempt.errorCode, attempt.errorMessage)
  }
  // SENT, including the idempotent ALREADY_SENT no-op (spec §11): the adapter
  // is never called again for a message that already went out.
  return toChannelDeliveryDto(attempt.delivery)
}


// ---------------------------------------------------------------------------
// The one outbound attempt (claim → adapter → SENT / FAILED), shared by the
// staff send above and the MCR-4 recovery engine below — no second delivery
// system. The ChannelDelivery id is passed to the adapter as the idempotency
// key, so a provider can dedupe a retry after an uncertain result.
// ---------------------------------------------------------------------------

export type DeliveryAttempt =
  | { status: 'SENT'; delivery: ChannelDelivery }
  | { status: 'FAILED'; delivery: ChannelDelivery; errorCode: string; errorMessage: string }
  | { status: 'IN_PROGRESS'; delivery: ChannelDelivery }
  /** MCR-7A — the provider may have the message: never resent automatically (callers treat it like IN_PROGRESS → DELIVERY_UNCERTAIN). */
  | { status: 'UNCERTAIN'; delivery: ChannelDelivery; errorCode: string }

async function attemptDelivery(
  tenantId: string,
  businessId: string,
  connection: Pick<ChannelConnection, 'id' | 'type'> & Partial<Pick<ChannelConnection, 'provider' | 'senderE164'>>,
  externalConversationId: string,
  message: Pick<Message, 'id' | 'content'>,
  template?: NormalizedOutboundMessage['template']
): Promise<DeliveryAttempt> {
  const claim = await channelDeliveryRepository.claimForSending(tenantId, businessId, connection.id, message.id)
  if (claim.outcome === 'ALREADY_SENT') return { status: 'SENT', delivery: claim.delivery }
  if (claim.outcome === 'IN_PROGRESS') return { status: 'IN_PROGRESS', delivery: claim.delivery }

  const delivery = claim.delivery
  const adapter = getChannelAdapter(connection.type, connection)
  // MCR-7B1 — free-form text on a session-bound channel (WhatsApp) only inside
  // the customer-service window; otherwise fail closed BEFORE any provider
  // call. Never silently turned into a template.
  if (adapter.freeFormRequiresOpenSession && !template && !(await isWhatsAppSessionOpen({ tenantId, businessId }, `+${externalConversationId.replace(/^\+/, '')}`, new Date()))) {
    const errorMessage = 'Outside the WhatsApp customer-service window (a template is required)'
    const failed = await channelDeliveryRepository.markFailed(delivery.id, 'WHATSAPP_SESSION_CLOSED', errorMessage)
    return { status: 'FAILED', delivery: failed, errorCode: 'WHATSAPP_SESSION_CLOSED', errorMessage }
  }
  try {
    const result = await adapter.sendMessage({
      channelType: connection.type,
      externalConversationId,
      content: message.content,
      ...(template ? { template } : {}),
      idempotencyKey: delivery.id,
    })
    if (result.success) {
      return { status: 'SENT', delivery: await channelDeliveryRepository.markSent(delivery.id, result.externalMessageId ?? null, adapter.provider ?? null) }
    }
    if (result.uncertain) {
      const errorMessage = safeErrorMessage(result.errorMessage, 'The channel provider outcome is unknown')
      return { status: 'UNCERTAIN', delivery: await channelDeliveryRepository.markUncertain(delivery.id, 'DELIVERY_UNCERTAIN', errorMessage, adapter.provider ?? null), errorCode: 'DELIVERY_UNCERTAIN' }
    }
    // Prompt 18: an adapter may classify its own failure (e.g. Telegram's
    // TELEGRAM_AUTH_ERROR/TELEGRAM_RATE_LIMITED/etc. — see
    // telegramApiClient.ts); fallback to the generic code when it doesn't.
    const errorCode = result.errorCode ?? 'CHANNEL_PROVIDER_ERROR'
    const errorMessage = safeErrorMessage(result.errorMessage, 'The channel provider failed to send this message')
    const failed = await channelDeliveryRepository.markFailed(delivery.id, errorCode, errorMessage)
    return { status: 'FAILED', delivery: failed, errorCode, errorMessage }
  } catch {
    // The adapter threw instead of returning a failure result — never let a
    // raw provider/SDK error escape. Marked FAILED like a reported failure.
    const errorMessage = 'The channel provider failed to send this message'
    const failed = await channelDeliveryRepository.markFailed(delivery.id, 'CHANNEL_PROVIDER_ERROR', errorMessage)
    return { status: 'FAILED', delivery: failed, errorCode: 'CHANNEL_PROVIDER_ERROR', errorMessage }
  }
}

/**
 * MCR-4 — sends an automated (senderType SYSTEM) outbound message through
 * its conversation's channel. No AuthContext and no user: the scope is the
 * tenant/business the caller already resolved from its own record. Same
 * ownership and channel checks as the staff path; only automated messages
 * pass: SYSTEM (MCR-4 recovery template) and AI (MCR-5 automatic replies).
 */
export async function deliverSystemMessage(
  scope: { tenantId: string; businessId: string },
  messageId: string,
  options: { template?: NormalizedOutboundMessage['template'] } = {}
): Promise<DeliveryAttempt> {
  const message = await messageRepository.findById(scope.tenantId, scope.businessId, messageId)
  if (!message || message.direction !== 'OUTBOUND' || (message.senderType !== 'SYSTEM' && message.senderType !== 'AI')) {
    throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Message not found')
  }
  const conversation = await conversationRepository.findById(scope.tenantId, scope.businessId, message.conversationId)
  if (!conversation?.channelConnectionId || !conversation.externalConversationId) {
    throw new ApiError(409, 'EXTERNAL_CONVERSATION_NOT_FOUND', 'This conversation has no external channel thread to send to')
  }
  const connection = await channelConnectionRepository.findById(scope.tenantId, scope.businessId, conversation.channelConnectionId)
  if (!connection) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  if (connection.status !== 'ACTIVE') throw new ApiError(409, 'CHANNEL_INACTIVE', 'Channel connection is inactive')
  if (channelTypeToConversationChannel(connection.type) !== conversation.channel) {
    throw new ApiError(409, 'CHANNEL_TYPE_MISMATCH', 'This conversation belongs to a different channel type')
  }
  return attemptDelivery(scope.tenantId, scope.businessId, connection, conversation.externalConversationId, message, options.template)
}
