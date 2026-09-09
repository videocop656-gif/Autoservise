import type { ChannelAdapter, ChannelSendResult, NormalizedIncomingMessage, NormalizedOutboundMessage } from '../types'
import { telegramApiClient, TelegramApiError } from './telegram/telegramApiClient'

// Telegram's own documented limit for a text message (Bot API `sendMessage`
// docs: "Text of the message to be sent, 1-4096 characters"). Checked
// BEFORE ever calling Telegram (spec §27: "не молча обрезать" — a message
// over the limit must fail loudly, never be silently truncated).
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

interface TelegramFrom {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramMessage {
  message_id: number
  date: number
  chat: TelegramChat
  from?: TelegramFrom
  text?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

/** A structurally valid, but not-a-supported-text-DM update — deliberately produced instead of thrown (see this file's own module doc below) so the existing, unmodified `receiveIncoming()` validation (`!normalized.text` → 400 INVALID_CHANNEL_PAYLOAD) rejects it exactly like any other invalid payload, never creating a Message with fabricated content (spec §9, §39, §41). */
function unsupportedResult(channelType: 'TELEGRAM', partial: { externalMessageId?: string; externalConversationId?: string } = {}): NormalizedIncomingMessage {
  return {
    channelType,
    externalMessageId: partial.externalMessageId ?? '',
    externalConversationId: partial.externalConversationId ?? '',
    text: '',
    sentAt: new Date(),
  }
}

/**
 * Real Telegram Bot API integration (Prompt 18) — the first non-mock
 * `ChannelAdapter` implementation. `ChannelType.TELEGRAM` is reused exactly
 * as-is (spec §2: no new enum, no `TelegramConversation`/`TelegramMessage`/
 * `TelegramCustomer` — Telegram adapts to the existing Conversation/Message/
 * CustomerChannelIdentity model, never the reverse).
 *
 * `parseIncoming` is intentionally synchronous and NEVER throws (spec's own
 * established convention — see adapters/mockAdapter.ts's identical
 * contract): unsupported content (non-text, non-private-chat, malformed
 * update) becomes an empty-`text` NormalizedIncomingMessage, which the
 * EXISTING, unmodified `receiveIncoming()` already rejects safely as
 * `INVALID_CHANNEL_PAYLOAD` — no new validation branch was added anywhere
 * else in the pipeline for this (spec §22: "не переписывать существующий
 * inbound service").
 *
 * `sendMessage` never touches Prisma/tenantId/businessId/Session (spec §8)
 * — `chatId`/`content` are the only inputs, both already server-resolved by
 * channelDeliveryService.ts before this is ever called.
 */
export function createTelegramAdapter(token: string): ChannelAdapter {
  return {
    channelType: 'TELEGRAM',

    parseIncoming(rawPayload: unknown): NormalizedIncomingMessage {
      // Defensive at every level — a webhook body can be anything: a
      // non-object (malformed JSON falls back to a raw string upstream —
      // see vite.config.ts's local API plugin), an update type this stage
      // doesn't support (`edited_message`/`channel_post`/`callback_query`),
      // or a well-formed `message` missing fields this stage requires.
      if (typeof rawPayload !== 'object' || rawPayload === null) {
        return unsupportedResult('TELEGRAM')
      }
      const update = rawPayload as Partial<TelegramUpdate>
      const message = update.message
      if (!message || typeof message !== 'object') {
        return unsupportedResult('TELEGRAM')
      }

      const chatId = message.chat?.id
      const messageId = message.message_id
      if (typeof chatId !== 'number' || typeof messageId !== 'number') {
        // Can't even build a deterministic id pair — nothing safe to do but
        // reject with empty ids (still never a thrown error).
        return unsupportedResult('TELEGRAM')
      }

      // Deterministic external ids (spec §10, §11) — never a random UUID,
      // always reproducible from the same (chatId, messageId)/(chatId)
      // pair, which is exactly what ChannelMessage's/Conversation's own
      // unique constraints rely on for inbound idempotency.
      const externalMessageId = `telegram:${chatId}:${messageId}`
      const externalConversationId = String(chatId)

      // Spec §39: groups/supergroups/channels are explicitly unsupported in
      // this MVP — safely rejected, never turned into a Conversation, but
      // still with real deterministic ids so the webhook route can still
      // safely acknowledge Telegram without creating anything.
      if (message.chat?.type !== 'private') {
        return unsupportedResult('TELEGRAM', { externalMessageId, externalConversationId })
      }

      // Spec §9: media/sticker/voice/photo/etc. (anything without `text`)
      // never gets a fabricated content string.
      if (typeof message.text !== 'string' || message.text.length === 0) {
        return unsupportedResult('TELEGRAM', { externalMessageId, externalConversationId })
      }

      const from = message.from
      // Spec §12/§14: from.id is the externalCustomerId; first/last name is
      // ONLY ever used as transient display metadata (customerName) for a
      // best-effort CustomerChannelIdentity.displayName — never written to
      // Customer.name/email/phone anywhere in this pipeline (see
      // channelCustomerService.ts, unchanged by this prompt). Telegram
      // never supplies a phone number on a plain text message, so
      // `customerPhone` is deliberately always left undefined here — phone-
      // based resolution (spec §13) simply never fires for Telegram in this
      // stage, which is the correct, honest behavior for the data Telegram
      // actually gives us.
      const externalCustomerId = typeof from?.id === 'number' ? String(from.id) : undefined
      const customerName = from ? [from.first_name, from.last_name].filter((part): part is string => !!part).join(' ').trim() || undefined : undefined

      return {
        channelType: 'TELEGRAM',
        externalMessageId,
        externalConversationId,
        externalCustomerId,
        customerName,
        text: message.text,
        sentAt: new Date(message.date * 1000),
      }
    },

    async sendMessage(input: NormalizedOutboundMessage): Promise<ChannelSendResult> {
      if (input.content.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        return {
          success: false,
          errorMessage: `Message exceeds Telegram's ${TELEGRAM_MAX_MESSAGE_LENGTH}-character limit`,
          errorCode: 'TELEGRAM_BAD_REQUEST',
          retryable: false,
        }
      }

      try {
        const sent = await telegramApiClient.sendMessage(token, input.externalConversationId, input.content)
        return { success: true, externalMessageId: String(sent.message_id) }
      } catch (err) {
        if (err instanceof TelegramApiError) {
          return { success: false, errorMessage: err.message, errorCode: err.code, retryable: err.retryable }
        }
        return { success: false, errorMessage: 'The Telegram provider failed to send this message', errorCode: 'TELEGRAM_PROVIDER_ERROR', retryable: true }
      }
    },
  }
}
