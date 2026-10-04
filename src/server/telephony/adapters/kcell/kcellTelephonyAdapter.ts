import { createHash } from 'node:crypto'
import { env } from '../../../lib/env'
import { timingSafeEqualStrings } from '../../../lib/timingSafeCompare'
import { TelephonyPayloadError, type NormalizedCallEvent, type TelephonyAdapter, type TelephonyWebhookRequest } from '../../types'

// ---------------------------------------------------------------------------
// MCR-8A — Kcell Virtual PBX ("Виртуальная АТС Kcell") CRM REST API adapter.
//
// Contract (Kcell CRM REST API — the cloud-PBX "REST API Облачной АТС",
// section 4 "Запросы от ВАТС к CRM"): the PBX POSTs to ONE CRM URL with
//   cmd=event    — a call event for one PBX user (one "leg"):
//                  type INCOMING / ACCEPTED / COMPLETED / CANCELLED /
//                  OUTGOING / TRANSFERRED, direction in/out, phone (client),
//                  diversion (our number the call came in on), user, ext,
//                  telnum, groupRealName, callid ("the same for all related
//                  calls"), crm_token. No event id, no timestamp.
//   cmd=history  — the call record after the call: type in/out, status
//                  Success / Missed / Cancel / Busy / NotAvailable /
//                  NotAllowed / NotFound, phone, diversion, user, start
//                  (UTC "YYYYmmddTHHMMSSZ"), duration (s), callid, link
//                  (recording), crm_token.
//   cmd=contact  — a name lookup for the caller (not used: we answer {}).
// Responses: JSON; 200 OK, 400 {error:"Invalid parameters"}, 401
// {error:"Invalid token"}.
//
// Authentication is the CRM token Kcell sends IN THE BODY (crm_token) — a
// shared secret over HTTPS, not a signature: it proves the sender knows the
// token, it does not bind the payload. One token per business
// (env.kcellCrmTokens); compared in constant time against every configured
// token (no early exit).
//
// THE critical rule: CANCELLED is NOT "missed". Kcell documents it as "the
// client didn't wait — OR, for a call to a group of managers, someone else
// may have answered". A CANCELLED event is therefore OBSERVED (recorded,
// never applied); only ACCEPTED / COMPLETED (answered) or the authoritative
// history status decides the call.
// ---------------------------------------------------------------------------

export const KCELL_PROVIDER = 'kcell'

export type KcellCommand = 'event' | 'history' | 'contact'

const MAX_KEYS = 40
const MAX_VALUE = 2000

/** Bounded flat params from the (form-urlencoded or JSON) body; null when not an object or oversized. */
export function kcellParams(body: unknown): Record<string, string> | null {
  // A raw form body (local dev / a runtime that didn't parse it) is decoded here.
  if (typeof body === 'string') {
    if (body.length > MAX_KEYS * MAX_VALUE) return null
    body = Object.fromEntries(new URLSearchParams(body))
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const entries = Object.entries(body as Record<string, unknown>)
  if (entries.length > MAX_KEYS) return null
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null
    const text = String(value)
    if (text.length > MAX_VALUE) return null
    out[key] = text.trim()
  }
  return out
}

/**
 * The business whose configured CRM token equals `provided`, or null.
 * Every configured token is compared (constant time each, no early exit).
 */
export function kcellBusinessForToken(provided: unknown, configured = env.kcellCrmTokens): string | null {
  if (typeof provided !== 'string' || provided === '') return null
  let match: string | null = null
  for (const entry of configured) {
    if (timingSafeEqualStrings(provided, entry.token) && match === null) match = entry.businessId
  }
  return match
}

/**
 * Kcell sends numbers as digits without "+" ("79101234567"). A full
 * international number (11–15 digits, not a national "8…" trunk form) gets
 * its "+" so routing can read it without a region; anything else is passed as
 * is and normalized later in the business's region (MCR-1) — never padded.
 */
export function kcellNumber(raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (value === '') return null
  if (/^\d{11,15}$/.test(value) && !value.startsWith('8')) return `+${value}`
  return value
}

const HIDDEN_CALLER = new Set(['anonymous', 'unknown', 'private', 'restricted', 'unavailable', 'hidden'])

/** "20170703T121110Z" (UTC) → Date; null when absent or not exactly that format. */
export function parseKcellTime(raw: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw?.trim() ?? '')
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number]
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null
}

/**
 * Deterministic event identity. Kcell sends no event id and (for events) no
 * time, so the fingerprint is a hash of the stable documented fields — never
 * the receipt time, never randomness. A redelivery is byte-for-byte the same
 * callback → the same fingerprint. Assumption (documented): the same leg
 * (user/ext) never legitimately reports the same event type twice within one
 * callid; if it ever did, the second is dropped — harmless, since a repeat of
 * the same event carries the same evidence.
 */
function fingerprint(kind: string, p: Record<string, string>, fields: string[]): string {
  const canonical = [kind, ...fields.map((f) => `${f}=${p[f] ?? ''}`)].join('\n')
  return `${kind}:${createHash('sha256').update(canonical).digest('hex').slice(0, 40)}`
}

const EVENT_FIELDS = ['callid', 'type', 'direction', 'user', 'ext', 'telnum', 'phone', 'diversion', 'groupRealName']
const HISTORY_FIELDS = ['callid', 'type', 'status', 'user', 'ext', 'telnum', 'phone', 'diversion', 'start', 'duration']

type Mapped = Pick<NormalizedCallEvent, 'eventType' | 'wasAnswered'>

/** Event `type` → evidence. CANCELLED / TRANSFERRED / unknown → OBSERVED (no outcome claim). */
export function mapKcellEvent(type: string): Mapped {
  switch (type.toUpperCase()) {
    case 'INCOMING':
    case 'OUTGOING':
      return { eventType: 'RINGING', wasAnswered: null }
    case 'ACCEPTED':
      return { eventType: 'ANSWERED', wasAnswered: null }
    // "Звонок успешно завершен (менеджер или клиент положили трубку после разговора)".
    case 'COMPLETED':
      return { eventType: 'COMPLETED', wasAnswered: true }
    default:
      return { eventType: 'OBSERVED', wasAnswered: null }
  }
}

/**
 * History `status` → the call's final outcome (authoritative). Success →
 * answered. Missed → missed. Cancel ("звонок отменен": the caller gave up
 * before anyone answered) → missed. Busy / NotAvailable / NotAllowed /
 * NotFound are documented for OUTBOUND only → not answered for an outbound
 * call (never a recovery lead: outbound is NOT_ELIGIBLE); on an inbound call
 * they are undocumented → OBSERVED. Unknown → OBSERVED.
 */
export function mapKcellHistory(status: string, direction: 'INBOUND' | 'OUTBOUND'): Mapped {
  const s = status.toLowerCase()
  if (s === 'success') return { eventType: 'COMPLETED', wasAnswered: true }
  if (s === 'missed' || s === 'cancel') return { eventType: 'COMPLETED', wasAnswered: false }
  if (['busy', 'notavailable', 'notallowed', 'notfound'].includes(s) && direction === 'OUTBOUND') return { eventType: 'COMPLETED', wasAnswered: false }
  return { eventType: 'OBSERVED', wasAnswered: null }
}

function direction(raw: string | undefined): 'INBOUND' | 'OUTBOUND' | null {
  const v = (raw ?? '').toLowerCase()
  return v === 'in' ? 'INBOUND' : v === 'out' ? 'OUTBOUND' : null
}

export function kcellCommand(params: Record<string, string>): KcellCommand | null {
  const cmd = params.cmd?.toLowerCase()
  return cmd === 'event' || cmd === 'history' || cmd === 'contact' ? cmd : null
}

/**
 * cmd=event / cmd=history → NormalizedCallEvent. Pure; throws
 * TelephonyPayloadError for anything unusable. `calledPhone` is the business
 * side of the call (diversion — "your number the call came in on"; for an
 * outbound call the business side is the CALLER, see callIntakeService) and
 * may be empty: the webhook service then routes only to an already known call.
 * Recording links, tokens and PBX user names never leave this function.
 */
export function parseKcell(params: Record<string, string>): NormalizedCallEvent {
  const cmd = kcellCommand(params)
  const callId = params.callid ?? ''
  if (cmd !== 'event' && cmd !== 'history') throw new TelephonyPayloadError('Unsupported Kcell command')
  if (!/^[\w.:@-]{1,200}$/.test(callId)) throw new TelephonyPayloadError('Missing Kcell callid')

  const isEvent = cmd === 'event'
  const type = params.type ?? ''
  const dir = isEvent ? (direction(params.direction) ?? (type.toUpperCase() === 'OUTGOING' ? 'OUTBOUND' : type ? 'INBOUND' : null)) : direction(type)
  if (!dir || (isEvent && !/^[A-Za-z_]{1,40}$/.test(type))) throw new TelephonyPayloadError('Invalid Kcell type/direction')
  const status = params.status ?? ''
  if (!isEvent && !/^[A-Za-z_]{1,40}$/.test(status)) throw new TelephonyPayloadError('Invalid Kcell history status')

  const client = params.phone && !HIDDEN_CALLER.has(params.phone.toLowerCase()) ? kcellNumber(params.phone) : null
  // Our number: diversion ("your number the call came in on"); for an outbound call, when
  // diversion is absent, the PBX user's direct number (telnum).
  const ours = kcellNumber(params.diversion) ?? (dir === 'OUTBOUND' ? kcellNumber(params.telnum) : null) ?? ''
  const mapped = isEvent ? mapKcellEvent(type) : mapKcellHistory(status, dir)

  let callStartedAt: Date | null = null
  let callEndedAt: Date | null = null
  if (!isEvent) {
    callStartedAt = parseKcellTime(params.start)
    const duration = /^\d{1,7}$/.test(params.duration ?? '') ? Number(params.duration) : null
    callEndedAt = callStartedAt && duration !== null ? new Date(callStartedAt.getTime() + duration * 1000) : null
  }

  return {
    provider: KCELL_PROVIDER,
    providerEventId: isEvent ? fingerprint('event', params, EVENT_FIELDS) : fingerprint('history', params, HISTORY_FIELDS),
    providerCallId: callId,
    eventType: mapped.eventType,
    direction: dir,
    // INBOUND: client → our number. OUTBOUND: our number → client.
    callerPhone: dir === 'INBOUND' ? client : ours || null,
    calledPhone: dir === 'INBOUND' ? ours : (client ?? ''),
    occurredAt: isEvent ? null : (callEndedAt ?? callStartedAt),
    wasAnswered: mapped.wasAnswered,
    callStartedAt,
    callEndedAt,
    providerStatus: (isEvent ? `event:${type.toUpperCase()}` : `history:${dir === 'INBOUND' ? 'in' : 'out'}:${status}`).slice(0, 60),
  }
}

/** The TelephonyAdapter view (MCR-2 boundary): verify = CRM token → its business; parse = parseKcell. */
export function createKcellTelephonyAdapter(): TelephonyAdapter {
  return {
    provider: KCELL_PROVIDER,
    verify(request: TelephonyWebhookRequest) {
      const params = kcellParams(request.body)
      const businessId = params ? kcellBusinessForToken(params.crm_token) : null
      return businessId ? { ok: true, accountBusinessId: businessId } : { ok: false }
    },
    parse(body: unknown) {
      const params = kcellParams(body)
      if (!params) throw new TelephonyPayloadError('Invalid Kcell payload')
      return parseKcell(params)
    },
  }
}
