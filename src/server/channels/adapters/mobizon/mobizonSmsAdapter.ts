import type { ChannelAdapter, ChannelSendResult, BusinessInitiatedCapability, NormalizedIncomingMessage } from '../../types'
import { ApiError } from '../../../lib/errors'
import { logger } from '../../../lib/logger'
import { estimateSmsSegments } from '../../../lib/smsSegments'
import { callMobizon, defaultFetch, MOBIZON_SEND_TIMEOUT_MS, MOBIZON_STATUS_TIMEOUT_MS, type FetchLike, type MobizonConfig, type MobizonHttpResult } from './mobizonClient'

// ---------------------------------------------------------------------------
// MCR-7A — the production SMS adapter (Mobizon Kazakhstan), behind the same
// provider-neutral ChannelAdapter boundary as the mock. The Recovery Engine
// and the delivery core never import this file; only the registry does.
//
// Outcome classes (ChannelSendResult):
//   ACCEPTED           code 0 + messageId               → success (SENT)
//   REJECTED           code 1/11/12 (bad number/params)  → failure, not retryable
//   PERMANENT_FAILURE  code 8/9/13/14 (key / access / account), other 4xx
//   TRANSIENT_FAILURE  code 30 (rate limit), 3/10/15/999, HTTP 429,
//                      connection never established      → failure, retryable
//   UNCERTAIN          timeout / reset after sending, 5xx without an API
//                      answer, code 0 without messageId, code 100, an
//                      unparseable answer                → uncertain: NEVER resent
//
// Mobizon's SendSmsMessage has NO idempotency key / client reference (checked
// against the official docs), so an ambiguous outcome cannot be retried
// safely — it becomes DELIVERY_UNCERTAIN for a person to decide.
// ---------------------------------------------------------------------------

export const MOBIZON_PROVIDER = 'mobizon'

const REJECTED_CODES = new Set([1, 11, 12])
const AUTH_CODES = new Set([8, 9, 13, 14])
const TRANSIENT_CODES = new Set([3, 10, 15, 999])

const fail = (errorCode: string, errorMessage: string, retryable: boolean): ChannelSendResult => ({ success: false, errorCode, errorMessage, retryable })
const uncertain = (reason: string): ChannelSendResult => ({
  success: false,
  uncertain: true,
  errorCode: 'DELIVERY_UNCERTAIN',
  errorMessage: `SMS provider outcome unknown (${reason}); not resent automatically`,
  retryable: false,
})

export function classifySendResult(result: MobizonHttpResult): ChannelSendResult {
  if (result.kind === 'NOT_SENT') return fail('PROVIDER_TRANSIENT_ERROR', 'SMS provider unreachable', true)
  if (result.kind === 'UNKNOWN') return uncertain(result.reason)
  const { httpStatus, body } = result
  if (!body) {
    if (httpStatus === 429) return fail('PROVIDER_RATE_LIMITED', 'SMS provider rate limit', true)
    if (httpStatus >= 400 && httpStatus < 500) return fail('PROVIDER_ERROR', `SMS provider HTTP ${httpStatus}`, false)
    return uncertain(`HTTP_${httpStatus}`)
  }
  if (body.code === 0) {
    const data = body.data as { messageId?: unknown } | null
    const id = data?.messageId
    if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && /^\d+$/.test(id))) {
      return { success: true, externalMessageId: String(id) }
    }
    return uncertain('NO_MESSAGE_ID')
  }
  if (body.code === 100) return uncertain('BACKGROUND')
  if (body.code === 30) return fail('PROVIDER_RATE_LIMITED', 'SMS provider rate limit', true)
  if (REJECTED_CODES.has(body.code)) return fail('SMS_REJECTED', 'SMS rejected by provider (number or parameters)', false)
  if (AUTH_CODES.has(body.code)) return fail('PROVIDER_AUTH_ERROR', 'SMS provider credentials / access error', false)
  if (TRANSIENT_CODES.has(body.code)) return fail('PROVIDER_TRANSIENT_ERROR', 'SMS provider temporary error', true)
  return fail('PROVIDER_ERROR', `SMS provider error code ${body.code}`, false)
}

/** Mobizon wants the recipient as digits only, international format (no "+"). */
function recipientDigits(externalConversationId: string): string | null {
  const digits = externalConversationId.replace(/^\+/, '')
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null
}

export interface MobizonAdapterDeps {
  fetchImpl?: FetchLike
}

export function createMobizonSmsAdapter(config: MobizonConfig, deps: MobizonAdapterDeps = {}): ChannelAdapter & { fetchStatus(messageId: string): Promise<MobizonStatusLookup> } {
  const fetchImpl = deps.fetchImpl ?? defaultFetch
  return {
    channelType: 'SMS',
    provider: MOBIZON_PROVIDER,
    parseIncoming(): NormalizedIncomingMessage {
      // Two-way SMS is a future stage: inbound SMS is refused, never guessed.
      throw new ApiError(400, 'CHANNEL_INBOUND_UNSUPPORTED', 'Inbound messages are not supported for this channel yet')
    },
    businessInitiatedCapability(destinationE164: string): BusinessInitiatedCapability {
      return recipientDigits(destinationE164) ? { eligible: true } : { eligible: false, reason: 'INVALID_DESTINATION' }
    },
    async sendMessage(input): Promise<ChannelSendResult> {
      const recipient = recipientDigits(input.externalConversationId)
      if (!recipient) return fail('INVALID_DESTINATION', 'Not a valid international phone number', false)
      const segments = estimateSmsSegments(input.content)
      const params: Record<string, string> = { recipient, text: input.content, 'params[shortenLinks]': '0' }
      if (config.sender) params.from = config.sender
      const result = classifySendResult(await callMobizon(config, fetchImpl, 'Message/SendSmsMessage', params, MOBIZON_SEND_TIMEOUT_MS))
      // ids, encoding and segments only — never the key, the number or the text
      logger.info('sms_provider_send', {
        provider: MOBIZON_PROVIDER,
        deliveryId: input.idempotencyKey ?? null,
        outcome: result.success ? 'ACCEPTED' : result.uncertain ? 'UNCERTAIN' : 'FAILED',
        errorCode: result.errorCode ?? null,
        encoding: segments.encoding,
        estimatedSegments: segments.segments,
      })
      return result
    },
    recoveryTemplateAvailable: () => false,
    fetchStatus: (messageId: string) => fetchMobizonStatus(config, fetchImpl, messageId),
  }
}

export type MobizonStatusLookup = { ok: true; status: string; segNum: number | null } | { ok: false; reason: string }

/** Message.GetSMSStatus for one id — the authoritative status (the webhook signature does not cover the report's data). */
export async function fetchMobizonStatus(config: MobizonConfig, fetchImpl: FetchLike, messageId: string): Promise<MobizonStatusLookup> {
  if (!/^\d+$/.test(messageId)) return { ok: false, reason: 'BAD_ID' }
  const result = await callMobizon(config, fetchImpl, 'Message/GetSMSStatus', { ids: messageId }, MOBIZON_STATUS_TIMEOUT_MS)
  if (result.kind !== 'RESPONSE') return { ok: false, reason: result.reason }
  if (!result.body || result.body.code !== 0 || !Array.isArray(result.body.data)) return { ok: false, reason: `API_${result.body?.code ?? result.httpStatus}` }
  const row = (result.body.data as Record<string, unknown>[]).find((r) => String(r.id) === messageId)
  if (!row || typeof row.status !== 'string') return { ok: false, reason: 'NOT_FOUND' }
  const seg = typeof row.segNum === 'number' ? row.segNum : typeof row.segNum === 'string' && /^\d+$/.test(row.segNum) ? Number(row.segNum) : null
  return { ok: true, status: row.status, segNum: seg }
}
