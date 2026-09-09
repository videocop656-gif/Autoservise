/**
 * The one place in this codebase that speaks HTTPS to the real Telegram Bot
 * API (spec §3: sendMessage/setWebhook/deleteWebhook/getWebhookInfo/getMe —
 * only these five methods, only because a real use case in this stage needs
 * each one). Pure transport: takes a bot token as a plain argument, returns
 * plain parsed results, and never touches Prisma, tenantId, businessId, or
 * any domain concept — the same isolation boundary telegramAdapter.ts's
 * `ChannelAdapter` implementation is built on top of (Prompt 17 spec §6,
 * reaffirmed by Prompt 18 spec §8: "Adapter не использует Prisma... не
 * знает tenantId/businessId").
 *
 * The bot token is used only to build the request URL — it is never logged,
 * never included in a thrown error's message, and never returned from any
 * function here. `TelegramApiError` carries a safe, classified `code` +
 * `message` + `retryable` (spec §28) instead of Telegram's raw response.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org'

export type TelegramErrorCode =
  | 'TELEGRAM_AUTH_ERROR'
  | 'TELEGRAM_BAD_REQUEST'
  | 'TELEGRAM_NOT_FOUND'
  | 'TELEGRAM_RATE_LIMITED'
  | 'TELEGRAM_NETWORK_ERROR'
  | 'TELEGRAM_PROVIDER_ERROR'

export class TelegramApiError extends Error {
  readonly code: TelegramErrorCode
  readonly retryable: boolean

  constructor(code: TelegramErrorCode, message: string, retryable: boolean) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

/** Telegram's own error shape classified into this codebase's small, fixed taxonomy (spec §28) — never the raw `description`/`error_code` returned to a caller beyond this module's own safe `message`. */
function classifyTelegramErrorCode(httpStatus: number): TelegramErrorCode {
  if (httpStatus === 401 || httpStatus === 403) return 'TELEGRAM_AUTH_ERROR'
  if (httpStatus === 404) return 'TELEGRAM_NOT_FOUND'
  if (httpStatus === 429) return 'TELEGRAM_RATE_LIMITED'
  if (httpStatus >= 400 && httpStatus < 500) return 'TELEGRAM_BAD_REQUEST'
  return 'TELEGRAM_PROVIDER_ERROR'
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
}

async function callTelegramApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    // A network-level failure (DNS, timeout, connection refused) never
    // reaches Telegram's own JSON error shape at all — classified as
    // retryable, same as a 5xx from Telegram itself would be.
    throw new TelegramApiError('TELEGRAM_NETWORK_ERROR', 'Could not reach the Telegram API', true)
  }

  let parsed: TelegramApiResponse<T> | undefined
  try {
    parsed = (await response.json()) as TelegramApiResponse<T>
  } catch {
    parsed = undefined
  }

  if (!response.ok || !parsed?.ok) {
    const code = classifyTelegramErrorCode(response.status)
    // Retryable for transient conditions (rate limit, network-adjacent 5xx
    // classified as PROVIDER_ERROR); not retryable for a permanent
    // configuration/request problem (bad token, malformed request, unknown
    // chat) — spec §13/§28.
    const retryable = code === 'TELEGRAM_RATE_LIMITED' || code === 'TELEGRAM_PROVIDER_ERROR'
    // A safe, generic message — never Telegram's raw `description` verbatim
    // (it could theoretically echo back request content) and never the
    // token, which never appears in this response body regardless.
    throw new TelegramApiError(code, `Telegram API request failed (${method})`, retryable)
  }

  return parsed.result as T
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  username?: string
}

export interface TelegramSentMessage {
  message_id: number
}

export interface TelegramWebhookInfo {
  url: string
  has_custom_certificate: boolean
  pending_update_count: number
}

export const telegramApiClient = {
  /** Confirms the token is valid and returns the bot's own stable identity (spec §6) — `result.id` is the immutable value this codebase uses as `ChannelConnection.externalAccountId`, never `result.username` (mutable). */
  getMe(token: string): Promise<TelegramUser> {
    return callTelegramApi<TelegramUser>(token, 'getMe')
  },

  /** Registers our webhook URL + secret token with Telegram (spec §32). `url` must be a public HTTPS address — Telegram itself rejects anything else. */
  setWebhook(token: string, url: string, secretToken: string): Promise<true> {
    return callTelegramApi<true>(token, 'setWebhook', { url, secret_token: secretToken })
  },

  /** Best-effort cleanup on deactivation (spec §34) — callers must treat a failure here as non-fatal to the deactivation itself. */
  deleteWebhook(token: string): Promise<true> {
    return callTelegramApi<true>(token, 'deleteWebhook')
  },

  getWebhookInfo(token: string): Promise<TelegramWebhookInfo> {
    return callTelegramApi<TelegramWebhookInfo>(token, 'getWebhookInfo')
  },

  /** `chatId` must already be the server-resolved external conversation id (spec §26) — never accepted from a client request. */
  sendMessage(token: string, chatId: string, text: string): Promise<TelegramSentMessage> {
    return callTelegramApi<TelegramSentMessage>(token, 'sendMessage', { chat_id: chatId, text })
  },
}
