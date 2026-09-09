import type { ChannelType, ConversationChannel } from '@prisma/client'

/**
 * The internal, channel-agnostic shape every inbound webhook payload is
 * converted into BEFORE anything in this codebase (Conversation/Customer
 * resolution, Message creation) ever sees it — spec §"NORMALIZED INCOMING
 * MESSAGE". A real Telegram/WhatsApp adapter's parseIncoming() would build
 * one of these from a real webhook body; the foundation mock adapters
 * (adapters/mockAdapter.ts) just pass a pre-shaped test payload through
 * unchanged.
 *
 * Deliberately excludes tenantId/businessId/userId/role/isAdmin/isOwner/
 * isManager — spec §"SECURITY OF NORMALIZED MESSAGE": there is no field
 * here for a channel payload to claim who it belongs to. Tenant/business
 * are always resolved server-side from the ChannelConnection the webhook
 * arrived on (channelMessageService.ts), never trusted from the payload.
 */
export interface NormalizedIncomingMessage {
  channelType: ChannelType
  externalMessageId: string
  externalConversationId: string
  externalCustomerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  /** Trimmed, 1–10000 chars — enforced by validation/channel.schemas.ts before this type is ever constructed from untrusted input. */
  text: string
  sentAt: Date
  /** Small, adapter-specific extras only — never used for authorization or identity resolution, and never persisted verbatim (Message.content only ever stores `text`). */
  metadata?: Record<string, unknown>
}

/**
 * The internal, channel-agnostic shape every outbound send attempt is built
 * from BEFORE the adapter ever sees it (Prompt 17 spec §7 "NORMALIZED
 * OUTBOUND PAYLOAD") — the outbound mirror of NormalizedIncomingMessage
 * above. `externalConversationId` always comes from the server-resolved
 * Conversation (never from client input — spec §8), and `content` is the
 * already-persisted Message's own content, never re-typed by the client.
 *
 * Deliberately excludes tenantId/businessId/userId/role/password/session/
 * any raw database object — same security boundary as
 * NormalizedIncomingMessage, mirrored for the opposite direction.
 */
export interface NormalizedOutboundMessage {
  channelType: ChannelType
  externalConversationId: string
  content: string
  /** Only present when the target Conversation has a known customer identity on this channel — most adapters (e.g. Website) will never need this, since externalConversationId alone is enough to address the reply. */
  externalCustomerId?: string
}

/** The result of a (mock, for this stage) outbound send attempt — never a raw provider/SDK response. */
export interface ChannelSendResult {
  success: boolean
  /** Present only on success — the mock/real channel's own id for the sent message. */
  externalMessageId?: string
  /** Present only on failure — a short, safe reason, never a raw provider error. */
  errorMessage?: string
  /**
   * Present only on failure (Prompt 17 spec §13) — whether a later retry of
   * the same message is expected to have a chance of succeeding. Defaults
   * to `true` when omitted (channelDeliveryService.ts's own conservative
   * default): an adapter that hasn't been taught to classify its own
   * failures yet should never silently block a legitimate retry. This
   * foundation stage never acts on this value beyond storing it — no
   * automatic retry worker exists (spec §13/§28).
   */
  retryable?: boolean
}

/**
 * The one boundary a real Telegram/WhatsApp/Website adapter would
 * implement later, without any other layer of this codebase (Conversation/
 * Message/Customer/AI/escalation/analytics) ever needing to change — spec
 * §"CHANNEL ADAPTER INTERFACE" and §"CHANNEL REGISTRY". `parseIncoming` is
 * intentionally synchronous and pure (real signature/webhook-secret
 * verification for a specific provider is production-hardening work, out
 * of scope here — spec §"WEBHOOK FOUNDATION"); `sendMessage` never makes a
 * real network call in this codebase today (spec §"OUTBOUND FOUNDATION"),
 * and never touches Prisma directly (Prompt 17 spec §6) — it only ever
 * receives/returns the plain, normalized shapes in this file.
 */
export interface ChannelAdapter {
  readonly channelType: ChannelType
  parseIncoming(rawPayload: unknown): NormalizedIncomingMessage
  sendMessage(input: NormalizedOutboundMessage): Promise<ChannelSendResult>
}

/**
 * `ChannelType` and `ConversationChannel` are deliberately two separate
 * enums (see schema.prisma's comment on both) — this is the one place
 * that bridges them, by shared member name. A compile-time exhaustiveness
 * check (the `never` branch) means adding a new ChannelType without also
 * teaching this function about it is a build failure, not a silent runtime
 * gap.
 */
export function channelTypeToConversationChannel(type: ChannelType): ConversationChannel {
  switch (type) {
    case 'TELEGRAM':
      return 'TELEGRAM'
    case 'WHATSAPP':
      return 'WHATSAPP'
    case 'WEBSITE':
      return 'WEBSITE'
    default: {
      const exhaustive: never = type
      throw new Error(`Unmapped ChannelType: ${String(exhaustive)}`)
    }
  }
}
