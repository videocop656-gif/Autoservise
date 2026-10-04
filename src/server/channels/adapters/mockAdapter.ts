import type { ChannelType } from '@prisma/client'
import type { BusinessInitiatedCapability, ChannelAdapter, ChannelSendResult, NormalizedIncomingMessage, NormalizedOutboundMessage } from '../types'
import { env } from '../../lib/env'
import { ApiError } from '../../lib/errors'

/**
 * Foundation-only mock adapter (spec §"MOCK ADAPTERS" / §"CHANNEL
 * ADAPTER INTERFACE") — never a real Telegram Bot API / WhatsApp Cloud
 * API / Twilio / Meta API client, and never makes a network call of any
 * kind. One factory rather than three near-identical classes (spec
 * explicitly allows "общий mock adapter factory, если это лучше
 * соответствует архитектуре") — the three channels' mock behavior is
 * identical; only `channelType` differs, and that's already carried by
 * the `ChannelConnection` row calling into this, not by which class is
 * used.
 *
 * `parseIncoming` — for this foundation stage, the test/webhook payload IS
 * already shaped like `NormalizedIncomingMessage` (a real Telegram/WhatsApp
 * adapter would instead translate that provider's actual webhook body
 * here); this function's job is only to validate the presence of the
 * fields it actually depends on and stamp `channelType`, never to trust
 * anything about tenant/business/customer identity beyond what's already
 * in the payload (see channel.schemas.ts for the real Zod-level
 * validation the payload has already passed by the time this is called).
 *
 * `sendMessage` always "succeeds" with a deterministic, fake external id —
 * a controlled, inspectable result for tests, never a real delivery.
 */
export function createMockAdapter(channelType: ChannelType): ChannelAdapter {
  return {
    channelType,
    parseIncoming(rawPayload: unknown): NormalizedIncomingMessage {
      // MCR-6 — SMS is outbound-only for now (recovery bridge to WhatsApp);
      // two-way SMS is a future stage, so an inbound SMS is refused, never guessed.
      if (channelType === 'SMS') {
        throw new ApiError(400, 'CHANNEL_INBOUND_UNSUPPORTED', 'Inbound messages are not supported for this channel yet')
      }
      const payload = rawPayload as Partial<NormalizedIncomingMessage> & { text?: string; sentAt?: string | Date }
      return {
        channelType,
        externalMessageId: String(payload.externalMessageId ?? ''),
        externalConversationId: String(payload.externalConversationId ?? ''),
        externalCustomerId: payload.externalCustomerId ? String(payload.externalCustomerId) : undefined,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerEmail: payload.customerEmail,
        text: String(payload.text ?? ''),
        sentAt: payload.sentAt instanceof Date ? payload.sentAt : new Date(payload.sentAt ?? Date.now()),
        metadata: payload.metadata,
      }
    },
    async sendMessage(input: NormalizedOutboundMessage): Promise<ChannelSendResult> {
      // A single, deterministic failure trigger for tests (Prompt 16 spec
      // "adapter failure → controlled CHANNEL_SEND_FAILED", Prompt 17 spec
      // §14 "a safe way to test provider failure... not a production secret
      // or debug endpoint") — never a real provider error, just a magic
      // string so channelDeliveryService.ts's FAILED/retry handling is
      // exercisable without touching the network stack at all. Always
      // reported as retryable — a real provider outage is exactly the kind
      // of transient failure a later retry is expected to recover from,
      // which is what lets the same magic string also exercise the
      // FAILED -> retry -> SENT path (Prompt 17 spec §24).
      if (input.content === '__mock_send_failure__') {
        return { success: false, errorMessage: 'Mock adapter simulated a send failure', retryable: true }
      }
      // MCR-4 — deterministic recovery failure for tests: a mock WhatsApp
      // destination ending in 0000 is "rejected by the provider".
      if ((channelType === 'WHATSAPP' || channelType === 'SMS') && input.idempotencyKey && /0000$/.test(input.externalConversationId)) {
        return { success: false, errorMessage: 'Mock provider rejected the destination', retryable: true, errorCode: 'CHANNEL_PROVIDER_ERROR' }
      }
      // With an idempotency key the provider id is deterministic (a retry of
      // the same delivery gets the same id, as a real provider would dedupe it).
      if (input.idempotencyKey) return { success: true, externalMessageId: `mock-out-${input.idempotencyKey}` }
      return { success: true, externalMessageId: `mock-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
    },
    // MCR-4 / MCR-6 — only the mock WHATSAPP and SMS channels may pose as
    // recovery channels, and only when RECOVERY_MOCK_CHANNEL_ENABLED=true
    // outside production. TECHNICAL capability only (see types.ts).
    businessInitiatedCapability(destinationE164: string): BusinessInitiatedCapability {
      if (channelType !== 'WHATSAPP' && channelType !== 'SMS') return { eligible: false, reason: 'BUSINESS_INITIATION_NOT_PERMITTED' }
      if (!env.recoveryMockChannelEnabled) return { eligible: false, reason: 'PROVIDER_UNAVAILABLE' }
      if (!/^\+[1-9]\d{6,14}$/.test(destinationE164)) return { eligible: false, reason: 'INVALID_DESTINATION' }
      return { eligible: true }
    },
    // MCR-6 — mock "approved provider templates": the connection's own config
    // key `approvedTemplates` (comma-separated template keys). WhatsApp only.
    recoveryTemplateAvailable(connection: { config: unknown }, templateKey: string): boolean {
      if (channelType !== 'WHATSAPP') return false
      const list = (connection.config as Record<string, unknown> | null)?.approvedTemplates
      return typeof list === 'string' && list.split(',').map((k) => k.trim()).includes(templateKey)
    },
  }
}
