import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { messageRepository } from '../repositories/messageRepository'
import { channelDeliveryRepository } from '../repositories/channelDeliveryRepository'
import { resolveActiveConnection } from './channelMessageService'
import { getChannelAdapter } from '../channels/channelAdapterRegistry'
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

  const claim = await channelDeliveryRepository.claimForSending(ctx.tenant.id, ctx.business.id, channelConnectionId, messageId)

  if (claim.outcome === 'ALREADY_SENT') {
    // Idempotent no-op (spec §11): the adapter is never called again, the
    // existing successful result is simply returned.
    return toChannelDeliveryDto(claim.delivery)
  }
  if (claim.outcome === 'IN_PROGRESS') {
    throw new ApiError(409, 'DELIVERY_IN_PROGRESS', 'This message is already being sent')
  }

  const delivery = claim.delivery
  const adapter = getChannelAdapter(connection.type)

  try {
    const result = await adapter.sendMessage({
      channelType: connection.type,
      externalConversationId: conversation.externalConversationId,
      content: message.content,
    })

    if (result.success) {
      const sent = await channelDeliveryRepository.markSent(delivery.id, result.externalMessageId ?? null)
      return toChannelDeliveryDto(sent)
    }

    const errorMessage = safeErrorMessage(result.errorMessage, 'The channel provider failed to send this message')
    await channelDeliveryRepository.markFailed(delivery.id, 'CHANNEL_PROVIDER_ERROR', errorMessage)
    throw new ApiError(502, 'CHANNEL_PROVIDER_ERROR', errorMessage)
  } catch (err) {
    if (err instanceof ApiError) throw err
    // The adapter threw instead of returning a failure result — never let a
    // raw exception (a real provider client would throw its own SDK error
    // type) reach the client. Marked FAILED exactly like a reported
    // failure, so it can be retried the same way.
    await channelDeliveryRepository.markFailed(delivery.id, 'CHANNEL_PROVIDER_ERROR', 'The channel provider failed to send this message')
    throw new ApiError(502, 'CHANNEL_PROVIDER_ERROR', 'The channel provider failed to send this message')
  }
}
