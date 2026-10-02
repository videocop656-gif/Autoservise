import { z } from 'zod'
import { env } from '../../lib/env'
import { timingSafeEqualStrings } from '../../lib/timingSafeCompare'
import { TelephonyPayloadError, type NormalizedCallEvent, type TelephonyAdapter, type TelephonyWebhookRequest } from '../types'

// ---------------------------------------------------------------------------
// MCR-2 — MOCK telephony provider. Lets the whole call-intake slice run before
// a real provider is chosen (MCR-8 replaces only this file's role).
//
// Its webhook shape is deliberately provider-like (its own field names), so
// the core is exercised through the same parse step a real adapter will
// have:
//   { "eventId", "callId", "event": "call.ringing" | "call.answered" |
//     "call.completed" | "call.missed", "direction": "inbound" | "outbound",
//     "from", "to", "timestamp"?, "answered"? }
// Any other field (e.g. a forged tenantId/businessId) is dropped here.
//
// Not a backdoor: verify() accepts a request only when
// TELEPHONY_MOCK_WEBHOOK_SECRET is configured, never in production, and only
// with that exact secret in the X-Mock-Telephony-Secret header (constant-time
// compare). Unconfigured → every request is rejected.
// ---------------------------------------------------------------------------

export const MOCK_PROVIDER = 'mock'
export const MOCK_SECRET_HEADER = 'x-mock-telephony-secret'

const EVENT_TYPES = {
  'call.ringing': 'RINGING',
  'call.answered': 'ANSWERED',
  'call.completed': 'COMPLETED',
  'call.missed': 'MISSED',
} as const

/** Values providers use for a withheld caller id. */
const HIDDEN_CALLER = new Set(['', 'anonymous', 'unknown', 'private', 'restricted', 'unavailable', 'hidden'])

const id = z.string().trim().min(1).max(200)

const mockPayloadSchema = z.object({
  eventId: id,
  callId: id,
  event: z.enum(['call.ringing', 'call.answered', 'call.completed', 'call.missed']),
  direction: z.enum(['inbound', 'outbound']).default('inbound'),
  from: z.string().trim().max(64).nullable().optional(),
  to: z.string().trim().min(1).max(64),
  timestamp: z.string().datetime({ offset: true }).optional(),
  answered: z.boolean().optional(),
})

export function createMockTelephonyAdapter(): TelephonyAdapter {
  return {
    provider: MOCK_PROVIDER,

    verify(request: TelephonyWebhookRequest) {
      const expected = env.telephonyMockWebhookSecret
      if (!expected || env.isProduction) return { ok: false }
      const header = request.headers[MOCK_SECRET_HEADER]
      const provided = typeof header === 'string' ? header : undefined
      return provided && timingSafeEqualStrings(provided, expected) ? { ok: true } : { ok: false }
    },

    parse(body: unknown): NormalizedCallEvent {
      const parsed = mockPayloadSchema.safeParse(body)
      if (!parsed.success) throw new TelephonyPayloadError('Invalid mock telephony payload')
      const p = parsed.data
      const caller = p.from ?? null
      return {
        provider: MOCK_PROVIDER,
        providerEventId: p.eventId,
        providerCallId: p.callId,
        eventType: EVENT_TYPES[p.event],
        direction: p.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND',
        callerPhone: caller === null || HIDDEN_CALLER.has(caller.toLowerCase()) ? null : caller,
        calledPhone: p.to,
        occurredAt: p.timestamp ? new Date(p.timestamp) : null,
        wasAnswered: p.event === 'call.completed' ? (p.answered ?? null) : null,
      }
    },
  }
}
