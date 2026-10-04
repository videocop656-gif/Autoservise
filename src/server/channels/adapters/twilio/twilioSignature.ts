import { createHmac } from 'node:crypto'
import { timingSafeEqualStrings } from '../../../lib/timingSafeCompare'

// ---------------------------------------------------------------------------
// MCR-7B1 — Twilio request validation (official "Webhooks security"):
//   data = full URL (as Twilio called it, query string included)
//          + every POST param, sorted by name (case-sensitive), name+value
//   X-Twilio-Signature = base64( HMAC-SHA1(AuthToken, data) )
// The URL is OUR canonical public URL (APP_URL + path), never a Host /
// X-Forwarded-* header the request could forge. Unlike Mobizon, the whole
// payload is signed.
// ---------------------------------------------------------------------------

export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = url + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join('')
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: unknown, authToken: string): boolean {
  if (typeof signature !== 'string' || signature.length === 0 || signature.length > 200) return false
  return timingSafeEqualStrings(signature, twilioSignature(url, params, authToken))
}

const MAX_PARAMS = 200
const MAX_VALUE = 20_000

/** Bounded form-params extraction: Vercel's parsed object or the raw urlencoded string. Null = malformed. */
export function formParams(body: unknown): Record<string, string> | null {
  let entries: [string, unknown][]
  if (typeof body === 'string') {
    if (body.length > 256 * 1024) return null
    entries = [...new URLSearchParams(body).entries()]
  } else if (body && typeof body === 'object' && !Array.isArray(body)) {
    entries = Object.entries(body as Record<string, unknown>)
  } else {
    return null
  }
  if (entries.length > MAX_PARAMS) return null
  const params: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || value.length > MAX_VALUE) return null
    params[key] = value
  }
  return params
}
