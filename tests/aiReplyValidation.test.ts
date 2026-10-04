import { describe, it, expect } from 'vitest'
import { validateAutoReply, type ReplyGrounding } from '../src/server/aiConversation/replyValidation'
import { isExplicitHumanRequest, isAutoReplyChannel } from '../src/server/aiConversation/policy'
import { describeServicePricing } from '../src/server/domain/pricing'
import { aiAutomationView } from '../src/components/conversations/aiAutomation'
import { buildSystemPrompt } from '../src/server/ai/promptBuilder'
import { isToolAllowed, toolDefinitionsForMode } from '../src/server/ai/executionMode'
import { TOOL_DEFINITIONS } from '../src/server/ai/tools/registry'
import type { AiBusinessContext } from '../src/server/ai/types'

// ---------------------------------------------------------------------------
// MCR-5 — the deterministic last gate before an automatic reply is sent
// (fail closed), the explicit-human-request detector, the auto_reply mode's
// capabilities and the operator status shown in Conversation Detail.
// ---------------------------------------------------------------------------

function svc(name: string, priceFrom: number | null, priceTo: number | null, extra: Partial<AiBusinessContext['services'][number]> = {}) {
  const p = describeServicePricing({ priceFrom, priceTo, currency: 'KZT' })
  return {
    id: name,
    name,
    description: null,
    pricing: { type: p.type, formatted: p.formatted, min: p.min, max: p.max },
    priceNote: null,
    requiresInspection: false,
    currency: 'KZT',
    durationMinutes: 60,
    ...extra,
  }
}

function grounding(over: Partial<AiBusinessContext['business']> = {}, extra: Partial<ReplyGrounding> = {}): ReplyGrounding {
  const context: AiBusinessContext = {
    business: { name: 'Тест', description: null, phone: '+7 727 250 00 00', email: null, address: 'г. Алматы, ул. Абая, 10', locationUrl: 'https://2gis.kz/x', timezone: 'Asia/Almaty', currency: 'KZT', ...over },
    currentDateTime: { date: '2026-10-05', time: '10:00', dayOfWeek: 'MONDAY' },
    workingHours: [{ dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '19:00' }],
    services: [
      svc('Кузовная покраска', 40000, null, { requiresInspection: true }),
      svc('Замена масла', 15000, 15000),
      svc('Шиномонтаж', 10000, 20000),
      svc('Ремонт подвески', null, null),
    ],
    knowledge: [{ title: 'Гарантия', content: 'Скидка 10% для постоянных клиентов.', category: 'GENERAL' }],
    rules: [],
    customer: null,
    vehicle: null,
    customerVehicles: [],
    upcomingAppointments: [],
    serviceHistory: [],
  }
  return { context, availabilitySlots: [], customerTexts: [], ...extra }
}
const v = (answer: string, g = grounding()) => validateAutoReply(answer, g)
const nbsp = (s: string) => s.replace(/ (?=\d{3}\b)/g, ' ')

describe('pricing grounding', () => {
  it('accepts configured prices with their type kept (incl. ru-RU no-break spaces)', () => {
    expect(v('Покраска — от 40 000 ₸, точная стоимость после осмотра.')).toEqual({ ok: true })
    expect(v(nbsp('Покраска — от 40 000 ₸, точная стоимость после осмотра.'))).toEqual({ ok: true })
    expect(v('Замена масла — 15 000 ₸.')).toEqual({ ok: true })
    expect(v('Шиномонтаж — 10 000–20 000 ₸.')).toEqual({ ok: true })
  })
  it('rejects an invented amount', () => expect(v('Покраска капота — 37 000 ₸, после осмотра.')).toEqual({ ok: false, code: 'UNGROUNDED_PRICE' }))
  it('rejects a FROM price turned into a fixed one', () => expect(v('Покраска стоит 40 000 ₸, после осмотра.')).toEqual({ ok: false, code: 'PRICE_TYPE_CHANGED' }))
  it('rejects a RANGE reduced to one end', () => expect(v('Шиномонтаж — 10 000 ₸.')).toEqual({ ok: false, code: 'PRICE_TYPE_CHANGED' }))
  it('rejects a price of an inspection service without the inspection caveat', () => expect(v('Покраска — от 40 000 ₸.')).toEqual({ ok: false, code: 'MISSING_INSPECTION_CAVEAT' }))
  it('rejects «примерно» prices', () => expect(v('Примерно 40 000 ₸ после осмотра.')).toEqual({ ok: false, code: 'APPROXIMATE_PRICE' }))
  it('rejects a bare invented figure even without a currency mark', () => expect(v('Обычно это 37 000.')).toEqual({ ok: false, code: 'UNGROUNDED_NUMBER' }))
  it('a Knowledge price never becomes a price (Service wins)', () => {
    const g = grounding()
    g.context.knowledge.push({ title: 'Покраска', content: 'Покраска стоит 25 000 ₸.', category: 'GENERAL' })
    expect(v('Покраска — 25 000 ₸.', g)).toEqual({ ok: false, code: 'UNGROUNDED_PRICE' })
  })
  it('rejects promotions the business never wrote about; allows its own', () => {
    expect(v('Сейчас акция — бесплатная мойка!')).toMatchObject({ ok: false, code: 'UNGROUNDED_PROMOTION' })
    expect(v('Для постоянных клиентов действует скидка 10%.')).toEqual({ ok: true })
  })
})

describe('location, hours, availability, safety', () => {
  it('address / map link only as configured', () => {
    expect(v('Мы находимся по адресу: г. Алматы, ул. Абая, 10. Карта: https://2gis.kz/x')).toEqual({ ok: true })
    expect(v('Мы на ул. Ленина, 5.')).toEqual({ ok: false, code: 'UNGROUNDED_ADDRESS' })
    expect(v('Мы на ул. Абая, 10.', grounding({ address: null }))).toEqual({ ok: false, code: 'UNGROUNDED_ADDRESS' })
    expect(v('Карта: https://maps.example.com/abc')).toEqual({ ok: false, code: 'UNGROUNDED_LINK' })
  })
  it('times only from real slots, configured hours or the customer’s own words', () => {
    expect(v('Работаем с 09:00 до 19:00.')).toEqual({ ok: true })
    expect(v('Свободно в 15:30.')).toEqual({ ok: false, code: 'UNGROUNDED_TIME' })
    expect(v('Свободно в 15:30.', grounding({}, { availabilitySlots: ['15:30'] }))).toEqual({ ok: true })
    expect(v('Хорошо, после 15:00 администратор предложит время.', grounding({}, { customerTexts: ['завтра после 15 можно?'] }))).toEqual({ ok: true })
  })
  it('never a booking claim, never internal text', () => {
    expect(v('Вы записаны на завтра.')).toMatchObject({ ok: false, code: 'UNCONFIRMED_BOOKING' })
    expect(v('Ждём вас завтра!')).toMatchObject({ ok: false, code: 'UNCONFIRMED_BOOKING' })
    expect(v('{"answer": "x"}')).toMatchObject({ ok: false, code: 'INTERNAL_TEXT' })
    expect(v('Согласно business context …')).toMatchObject({ ok: false, code: 'INTERNAL_TEXT' })
    expect(v('')).toEqual({ ok: false, code: 'EMPTY' })
    expect(v('а'.repeat(1001))).toEqual({ ok: false, code: 'TOO_LONG' })
  })
  it('the customer’s own numbers (car year, mileage) may be echoed', () => {
    expect(v('BMW X5 2018 года — подходит, ждём на осмотр.', grounding({}, { customerTexts: ['BMW X5 2018'] }))).toEqual({ ok: true })
  })
})

describe('explicit human request (deterministic, before any model call)', () => {
  it.each(['Позовите человека', 'Соедините с мастером', 'Хочу поговорить с администратором', 'Позвоните мне', 'Нужен мастер', 'Позовите лучше мастера', 'Соедините с живым оператором'])(
    '%s → handoff',
    (text) => expect(isExplicitHumanRequest(text)).toBe(true)
  )
  it.each(['Мастер сказал, что нужна покраска', 'Сколько стоит замена масла?', 'Нужно покрасить капот'])('%s → not a handoff', (text) =>
    expect(isExplicitHumanRequest(text)).toBe(false)
  )
})

describe('auto_reply mode capabilities & channels', () => {
  it('read-only availability only — no booking tool is offered or allowed', () => {
    expect(toolDefinitionsForMode(TOOL_DEFINITIONS, 'auto_reply').map((d) => d.name)).toEqual(['check_availability'])
    for (const tool of ['create_appointment', 'reschedule_appointment', 'cancel_appointment']) expect(isToolAllowed('auto_reply', tool)).toBe(false)
  })
  it('the prompt carries the core conversation principle; other modes are unchanged by it', () => {
    expect(buildSystemPrompt('auto_reply')).toContain('не пытайся решить всю проблему автомобиля в чате')
    expect(buildSystemPrompt('draft')).not.toContain('РЕЖИМ АВТОМАТИЧЕСКОГО ОТВЕТА')
    expect(buildSystemPrompt('interactive')).not.toContain('РЕЖИМ АВТОМАТИЧЕСКОГО ОТВЕТА')
  })
  it('only WhatsApp is an auto-reply channel (Telegram behaviour unchanged)', () => {
    expect(isAutoReplyChannel('WHATSAPP')).toBe(true)
    for (const c of ['TELEGRAM', 'MANUAL', 'PHONE', 'WEBSITE', 'OTHER'] as const) expect(isAutoReplyChannel(c)).toBe(false)
  })
})

describe('operator status (Conversation Detail)', () => {
  const base = { businessEnabled: true, channel: 'WHATSAPP' as const, status: 'OPEN' as const, pausedAt: null, pausedReason: null }
  it('active → «AI отвечает автоматически», can pause', () => expect(aiAutomationView(base)).toMatchObject({ kind: 'ACTIVE', label: 'AI отвечает автоматически' }))
  it('paused → «AI приостановлен» with the reason, can resume', () =>
    expect(aiAutomationView({ ...base, pausedAt: '2026-10-05T05:00:00Z', pausedReason: 'HUMAN_TAKEOVER' })).toMatchObject({ kind: 'PAUSED', label: 'AI приостановлен', hint: expect.stringContaining('сотрудник ответил клиенту') }))
  it('business switch off / other channel / closed → unavailable', () => {
    expect(aiAutomationView({ ...base, businessEnabled: false })).toMatchObject({ kind: 'UNAVAILABLE', label: 'Автоответы AI выключены' })
    expect(aiAutomationView({ ...base, channel: 'TELEGRAM' })).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(aiAutomationView({ ...base, status: 'CLOSED' })).toMatchObject({ kind: 'UNAVAILABLE' })
  })
})
