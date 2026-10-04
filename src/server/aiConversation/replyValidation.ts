import type { AiBusinessContext } from '../ai/types'
import { AI_REPLY_MAX_LENGTH } from './policy'

// ---------------------------------------------------------------------------
// MCR-5 — the last gate before an automatic reply reaches a customer. Runs
// AFTER the core's own Zod + safety layer (safety.ts) and checks the text
// against the authoritative data the model was given. Deterministic and
// deliberately strict: anything it cannot ground is NOT sent — the worker
// hands the conversation to a person instead (fail closed). A false
// rejection costs a human reply; a false acceptance costs a wrong promise.
// ---------------------------------------------------------------------------

export type ReplyRejectionCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INTERNAL_TEXT'
  | 'UNGROUNDED_PRICE'
  | 'APPROXIMATE_PRICE'
  | 'PRICE_TYPE_CHANGED'
  | 'MISSING_INSPECTION_CAVEAT'
  | 'UNGROUNDED_NUMBER'
  | 'UNGROUNDED_LINK'
  | 'UNGROUNDED_ADDRESS'
  | 'UNGROUNDED_TIME'
  | 'UNCONFIRMED_BOOKING'
  | 'UNGROUNDED_PROMOTION'

export type ReplyValidation = { ok: true } | { ok: false; code: ReplyRejectionCode }

export interface ReplyGrounding {
  context: AiBusinessContext
  /** Local "HH:mm" slot starts returned by check_availability in THIS turn. */
  availabilitySlots: string[]
  /** What the customer wrote (this message + earlier ones) — numbers/times the customer said may be echoed. */
  customerTexts: string[]
}

/** Thin / no-break spaces → plain space (ru-RU number grouping uses U+00A0 / U+202F). */
const norm = (text: string) => text.replace(/[   ]/g, ' ')

const CURRENCY = String.raw`(?:₸|тг\.?|тенге|₽|руб(?:\.|лей|ля|ль)?|р\.|\$|€|KZT|RUB|USD|EUR)`
/** "40 000 ₸", "10 000–20 000 ₸", "1 500,50 руб." — the amount right before a currency mark. */
const AMOUNT_WITH_CURRENCY = new RegExp(String.raw`(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,2}))?\s*` + CURRENCY, 'giu')
/** The first amount of a range "10 000–20 000 ₸" (its currency mark belongs to the second). */
const RANGE_FIRST_AMOUNT = new RegExp(String.raw`(\d{1,3}(?: \d{3})+|\d+)\s*[–—-]\s*(?:\d{1,3}(?: \d{3})+|\d+)\s*` + CURRENCY, 'giu')

const toAmount = (digits: string, fraction?: string) => Number(`${digits.replace(/ /g, '')}${fraction ? `.${fraction}` : ''}`)

const INTERNAL_TEXT = /needsHuman|business\s*context|businessContext|system\s*prompt|check_availability|create_appointment|services\[|\bjson\b|\btools?\b|[{}]|AI_SAFETY|\bnull\b/i
const APPROXIMATE = new RegExp(String.raw`(примерно|около|приблизительно|порядка|где-то)\s+(от\s+)?\d[\d ]*\s*` + CURRENCY, 'iu')
const BOOKING_CLAIM = /вы\s+записаны|записал[аи]?\s+вас|запись\s+(подтвержден|создан|оформлен)|ждём\s+вас\s+(завтра|сегодня|в\s+\d)|ждем\s+вас\s+(завтра|сегодня|в\s+\d)/iu
const PROMOTION = /скидк|акци[яиюей]|промокод|бесплатн|подарок|бонус/iu
const ADDRESS_MARK = /(^|[\s,(])(ул\.|улиц[аеуы]|проспект|пр-т|пр\.|мкр\.?|микрорайон|переулок|пер\.|шоссе|бульвар|б-р|площадь|трасса)(\s|$)/iu
const URL = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/giu
const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g

function groundedAmounts(context: AiBusinessContext): Set<number> {
  const amounts = new Set<number>()
  for (const s of context.services) {
    if (s.pricing.min) amounts.add(Number(s.pricing.min))
    if (s.pricing.max) amounts.add(Number(s.pricing.max))
  }
  for (const r of context.serviceHistory) amounts.add(Number(r.totalPrice))
  return amounts
}

/** Every number the model may legitimately repeat: anything in its own (server-built) context or in the customer's words. */
function groundedNumbers(grounding: ReplyGrounding): Set<number> {
  const sources = norm([JSON.stringify(grounding.context), ...grounding.customerTexts, ...grounding.availabilitySlots].join(' '))
  const numbers = new Set<number>()
  for (const m of sources.matchAll(/\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?/g)) numbers.add(Number(m[0].replace(/ /g, '').replace(',', '.')))
  return numbers
}

function normalizeTime(h: string, m: string): string {
  return `${h.padStart(2, '0')}:${m}`
}

function groundedTimes(grounding: ReplyGrounding): Set<string> {
  const times = new Set<string>(grounding.availabilitySlots)
  for (const d of grounding.context.workingHours) {
    if (d.openTime) times.add(d.openTime)
    if (d.closeTime) times.add(d.closeTime)
  }
  for (const text of grounding.customerTexts) for (const m of norm(text).matchAll(TIME)) times.add(normalizeTime(m[1]!, m[2]!))
  // «после 15» / «к 9» from the customer → 15:00 / 09:00
  for (const text of grounding.customerTexts) for (const m of text.matchAll(/(?:после|к|с|до|в)\s+(\d{1,2})(?![\d:.])/giu)) times.add(normalizeTime(m[1]!, '00'))
  return times
}

export function validateAutoReply(answer: string, grounding: ReplyGrounding): ReplyValidation {
  const text = norm(answer).trim()
  const { context } = grounding
  if (!text) return { ok: false, code: 'EMPTY' }
  if (text.length > AI_REPLY_MAX_LENGTH) return { ok: false, code: 'TOO_LONG' }
  if (INTERNAL_TEXT.test(text)) return { ok: false, code: 'INTERNAL_TEXT' }
  if (BOOKING_CLAIM.test(text)) return { ok: false, code: 'UNCONFIRMED_BOOKING' }
  if (APPROXIMATE.test(text)) return { ok: false, code: 'APPROXIMATE_PRICE' }

  // Prices: every amount next to a currency mark must be a configured price.
  const allowed = groundedAmounts(context)
  const found: { amount: number; index: number }[] = []
  for (const m of text.matchAll(AMOUNT_WITH_CURRENCY)) found.push({ amount: toAmount(m[1]!, m[2]), index: m.index! })
  for (const m of text.matchAll(RANGE_FIRST_AMOUNT)) found.push({ amount: toAmount(m[1]!), index: m.index! })
  if (found.some((f) => !allowed.has(f.amount))) return { ok: false, code: 'UNGROUNDED_PRICE' }

  // The price TYPE survives: FROM stays «от …», RANGE keeps both ends; inspection caveat kept.
  for (const s of context.services) {
    const min = s.pricing.min ? Number(s.pricing.min) : null
    if (min === null) continue
    const hits = found.filter((f) => f.amount === min)
    if (hits.length === 0) continue
    if (s.pricing.type === 'FROM' && hits.some((h) => !/от\s*$/iu.test(text.slice(Math.max(0, h.index - 6), h.index)))) {
      return { ok: false, code: 'PRICE_TYPE_CHANGED' }
    }
    if (s.pricing.type === 'RANGE' && s.pricing.max && !found.some((f) => f.amount === Number(s.pricing.max))) {
      return { ok: false, code: 'PRICE_TYPE_CHANGED' }
    }
    if (s.requiresInspection && !/осмотр|диагностик/iu.test(text)) return { ok: false, code: 'MISSING_INSPECTION_CAVEAT' }
  }

  // Any other sizeable number must come from the context or the customer (no invented figures).
  const numbers = groundedNumbers(grounding)
  for (const m of text.matchAll(/\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?/g)) {
    const value = Number(m[0].replace(/ /g, '').replace(',', '.'))
    if (value >= 100 && !numbers.has(value)) return { ok: false, code: 'UNGROUNDED_NUMBER' }
  }

  // Links: only the configured map link / website.
  const links = [context.business.locationUrl].filter((v): v is string => !!v)
  for (const m of text.matchAll(URL)) {
    const url = m[0].replace(/[.,;!?]+$/, '')
    if (!links.some((l) => l === url || l.replace(/\/$/, '') === url.replace(/\/$/, ''))) return { ok: false, code: 'UNGROUNDED_LINK' }
  }

  // Addresses: a street-like mention must be the configured address, verbatim.
  if (ADDRESS_MARK.test(text)) {
    const address = context.business.address ? norm(context.business.address).trim() : null
    if (!address || !text.toLowerCase().includes(address.toLowerCase())) return { ok: false, code: 'UNGROUNDED_ADDRESS' }
  }

  // Clock times: only real availability slots, configured hours or the customer's own words.
  const times = groundedTimes(grounding)
  for (const m of text.matchAll(TIME)) {
    if (!times.has(normalizeTime(m[1]!, m[2]!))) return { ok: false, code: 'UNGROUNDED_TIME' }
  }

  // Discounts / promotions only when the business itself wrote about them.
  const promo = PROMOTION.exec(text)
  if (promo) {
    const ownText = [...context.knowledge.map((k) => `${k.title} ${k.content}`), ...context.rules.map((r) => `${r.name} ${r.description}`), ...context.services.map((s) => `${s.description ?? ''} ${s.priceNote ?? ''}`)].join(' ')
    if (!new RegExp(promo[0], 'iu').test(ownText)) return { ok: false, code: 'UNGROUNDED_PROMOTION' }
  }

  return { ok: true }
}
