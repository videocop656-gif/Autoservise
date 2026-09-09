import type { ChannelType } from '@prisma/client'
import type { ChannelAdapter, ChannelSendInput, ChannelSendResult, NormalizedIncomingMessage } from '../types'

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
    async sendMessage(input: ChannelSendInput): Promise<ChannelSendResult> {
      // A single, deterministic failure trigger for tests (spec §44 "adapter
      // failure → controlled CHANNEL_SEND_FAILED") — never a real provider
      // error, just a magic string so channelMessageService.ts's error
      // mapping is exercisable without touching the network stack at all.
      if (input.text === '__mock_send_failure__') {
        return { success: false, errorMessage: 'Mock adapter simulated a send failure' }
      }
      return { success: true, externalMessageId: `mock-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
    },
  }
}
