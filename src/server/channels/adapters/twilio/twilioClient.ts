import type { FetchLike } from '../mobizon/mobizonClient'

// ---------------------------------------------------------------------------
// MCR-7B1 — Twilio REST client for the Messages API (official docs:
// twilio.com/docs/messaging/api/message-resource).
//
//   POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
//   Authorization: Basic base64(AccountSid:AuthToken)
//   body: application/x-www-form-urlencoded (To, From, Body | ContentSid +
//         ContentVariables, StatusCallback)
//
// The Auth Token only ever lives in the Authorization header built here —
// never in a URL, never logged. Repository-native fetch (injectable), explicit
// timeout + abort, bounded response. No SDK.
// ---------------------------------------------------------------------------

export interface TwilioCredentials {
  accountSid: string
  authToken: string
}

const TWILIO_API_ORIGIN = 'https://api.twilio.com'
const MAX_RESPONSE_CHARS = 64 * 1024
export const TWILIO_SEND_TIMEOUT_MS = 8_000
const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'])

export type TwilioHttpResult =
  | { kind: 'RESPONSE'; httpStatus: number; json: Record<string, unknown> | null }
  /** Certainly never reached Twilio (DNS / connection refused). */
  | { kind: 'NOT_SENT'; reason: string }
  /** May have reached Twilio (timeout, reset, abort mid-flight). */
  | { kind: 'UNKNOWN'; reason: string }

export async function createTwilioMessage(
  credentials: TwilioCredentials,
  fetchImpl: FetchLike,
  params: Record<string, string>,
  timeoutMs: number = TWILIO_SEND_TIMEOUT_MS
): Promise<TwilioHttpResult> {
  const url = `${TWILIO_API_ORIGIN}/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`
  const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`, 'utf8').toString('base64')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    })
    const text = await response.text()
    let json: Record<string, unknown> | null = null
    if (text.length <= MAX_RESPONSE_CHARS) {
      try {
        const parsed = JSON.parse(text)
        json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
      } catch {
        json = null
      }
    }
    return { kind: 'RESPONSE', httpStatus: response.status, json }
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code
    if (code && NOT_SENT_CODES.has(code)) return { kind: 'NOT_SENT', reason: code }
    return { kind: 'UNKNOWN', reason: controller.signal.aborted ? 'TIMEOUT' : (code ?? 'NETWORK_ERROR') }
  } finally {
    clearTimeout(timer)
  }
}
