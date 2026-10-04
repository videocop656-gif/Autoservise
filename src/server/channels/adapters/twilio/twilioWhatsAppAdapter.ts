import type { BusinessInitiatedCapability, ChannelAdapter, ChannelSendResult, NormalizedIncomingMessage, NormalizedOutboundMessage } from '../../types'
import { ApiError } from '../../../lib/errors'
import { logger } from '../../../lib/logger'
import { defaultFetch, type FetchLike } from '../mobizon/mobizonClient'
import { createTwilioMessage, type TwilioCredentials, type TwilioHttpResult } from './twilioClient'

// ---------------------------------------------------------------------------
// MCR-7B1 — the production WhatsApp adapter (Twilio), behind the same
// provider-neutral ChannelAdapter as the mock. One instance per WhatsApp
// ChannelConnection: it sends FROM that connection's own sender
// (whatsapp:+E164). The Recovery Engine, MCR-5 and the delivery core never
// import this file; only the registry does.
//
// Free-form text needs an open customer-service window (enforced by the
// delivery core before sendMessage — freeFormRequiresOpenSession). A
// templated message (input.template) is sent ONLY as the approved Content
// Template (ContentSid) configured for its key — never as free text.
//
// Twilio's Messages API documents NO idempotency key: an ambiguous outcome
// (timeout / reset / 5xx / 2xx without a sid) is reported `uncertain` and is
// never resent (DELIVERY_UNCERTAIN).
// ---------------------------------------------------------------------------

export const TWILIO_PROVIDER = 'twilio'
const MESSAGE_SID = /^(SM|MM)[0-9a-fA-F]{32}$/

export interface TwilioWhatsAppConfig extends TwilioCredentials {
  /** This connection's sender, canonical E.164. */
  senderE164: string
  /** Public status-callback URL, or null (no delivery reports). */
  statusCallbackUrl: string | null
  /** Internal template key → approved ContentSid. */
  templates: Record<string, string>
}

const fail = (errorCode: string, errorMessage: string, retryable: boolean): ChannelSendResult => ({ success: false, errorCode, errorMessage, retryable })
const uncertain = (reason: string): ChannelSendResult => ({
  success: false,
  uncertain: true,
  errorCode: 'DELIVERY_UNCERTAIN',
  errorMessage: `WhatsApp provider outcome unknown (${reason}); not resent automatically`,
  retryable: false,
})

/** Twilio error codes verified against the official error dictionary. */
export function classifyTwilioResult(result: TwilioHttpResult): ChannelSendResult {
  if (result.kind === 'NOT_SENT') return fail('PROVIDER_TRANSIENT_ERROR', 'WhatsApp provider unreachable', true)
  if (result.kind === 'UNKNOWN') return uncertain(result.reason)
  const { httpStatus, json } = result
  if (httpStatus >= 200 && httpStatus < 300) {
    const sid = json?.sid
    return typeof sid === 'string' && MESSAGE_SID.test(sid) ? { success: true, externalMessageId: sid } : uncertain('NO_SID')
  }
  const code = typeof json?.code === 'number' ? json.code : null
  // 20429 / HTTP 429: "Requests that receive 429 responses aren't processed and are safe to retry."
  if (httpStatus === 429 || code === 20429) return fail('PROVIDER_RATE_LIMITED', 'WhatsApp provider rate limit', true)
  if (httpStatus === 401 || httpStatus === 403) return fail('PROVIDER_AUTH_ERROR', 'WhatsApp provider credentials / access error', false)
  // 63016: free-form outside the customer-service window (a template is required).
  if (code === 63016) return fail('WHATSAPP_SESSION_CLOSED', 'Outside the WhatsApp customer-service window', false)
  // 21211: invalid "To".
  if (code === 21211) return fail('INVALID_DESTINATION', 'Not a valid WhatsApp destination', false)
  if (httpStatus >= 400 && httpStatus < 500) return fail('WHATSAPP_REJECTED', `WhatsApp provider rejected the message${code ? ` (${code})` : ''}`, false)
  return uncertain(`HTTP_${httpStatus}`) // 5xx: the message may exist
}

function destinationDigits(externalConversationId: string): string | null {
  const digits = externalConversationId.replace(/^\+/, '')
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null
}

/**
 * Twilio inbound webhook params → the channel-agnostic message. The customer
 * is `From` (whatsapp:+E164); the thread key is its digits — the same key the
 * MCR-6 window and the SMS bridge use. Media / location without text get a
 * deterministic operator-visible placeholder (never invented content).
 */
export function parseTwilioInbound(params: Record<string, string>): NormalizedIncomingMessage {
  const from = (params.From ?? '').replace(/^whatsapp:/i, '')
  const digits = destinationDigits(from)
  if (!params.MessageSid || !digits) throw new ApiError(400, 'INVALID_CHANNEL_PAYLOAD', 'Invalid channel payload')
  return {
    channelType: 'WHATSAPP',
    externalMessageId: params.MessageSid,
    externalConversationId: digits,
    externalCustomerId: digits,
    customerPhone: `+${digits}`,
    customerName: params.ProfileName?.slice(0, 200) || undefined,
    text: inboundText(params),
    sentAt: new Date(),
  }
}

export type InboundKind = 'TEXT' | 'MEDIA' | 'LOCATION'

export function inboundKind(params: Record<string, string>): InboundKind {
  if ((params.Body ?? '').trim()) return 'TEXT'
  if (params.Latitude || params.Longitude) return 'LOCATION'
  return 'MEDIA'
}

function inboundText(params: Record<string, string>): string {
  const body = (params.Body ?? '').trim().slice(0, 10_000)
  const media = Number(params.NumMedia ?? '0')
  const note = media > 0 ? `[Вложение${media > 1 ? ` ×${media}` : ''}: ${(params.MediaContentType0 ?? 'файл').slice(0, 60)}]` : ''
  if (body) return note ? `${body}\n${note}` : body
  if (params.Latitude || params.Longitude) return '[Клиент отправил геолокацию]'
  return note || '[Клиент отправил сообщение без текста]'
}

export interface TwilioAdapterDeps {
  fetchImpl?: FetchLike
}

export function createTwilioWhatsAppAdapter(config: TwilioWhatsAppConfig, deps: TwilioAdapterDeps = {}): ChannelAdapter {
  const fetchImpl = deps.fetchImpl ?? defaultFetch
  return {
    channelType: 'WHATSAPP',
    provider: TWILIO_PROVIDER,
    freeFormRequiresOpenSession: true,
    parseIncoming: (raw) => parseTwilioInbound(raw as Record<string, string>),
    businessInitiatedCapability(destinationE164: string): BusinessInitiatedCapability {
      return destinationDigits(destinationE164) ? { eligible: true } : { eligible: false, reason: 'INVALID_DESTINATION' }
    },
    recoveryTemplateAvailable: (_connection, templateKey) => !!config.templates[templateKey],
    async sendMessage(input: NormalizedOutboundMessage): Promise<ChannelSendResult> {
      const digits = destinationDigits(input.externalConversationId)
      if (!digits) return fail('INVALID_DESTINATION', 'Not a valid international phone number', false)
      const params: Record<string, string> = { To: `whatsapp:+${digits}`, From: `whatsapp:${config.senderE164}` }
      if (input.template) {
        const contentSid = config.templates[input.template.key]
        // Never degrade a business-initiated template into free text.
        if (!contentSid) return fail('TEMPLATE_UNAVAILABLE', 'No approved template configured for this message', false)
        params.ContentSid = contentSid
        params.ContentVariables = JSON.stringify(input.template.variables)
      } else {
        params.Body = input.content
      }
      if (config.statusCallbackUrl) params.StatusCallback = config.statusCallbackUrl
      const result = classifyTwilioResult(await createTwilioMessage(config, fetchImpl, params))
      logger.info('whatsapp_provider_send', {
        provider: TWILIO_PROVIDER,
        deliveryId: input.idempotencyKey ?? null,
        kind: input.template ? 'TEMPLATE' : 'FREE_FORM',
        outcome: result.success ? 'ACCEPTED' : result.uncertain ? 'UNCERTAIN' : 'FAILED',
        errorCode: result.errorCode ?? null,
      })
      return result
    },
  }
}
