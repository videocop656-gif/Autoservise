import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'
import { describeServicePricing, formatAmount, currencySymbol } from '../src/server/domain/pricing'
import { createServiceSchema, updateServiceSchema, PRICE_TO_WITHOUT_FROM } from '../src/server/validation/service.schemas'
import { businessProfileSchema, isSafeLocationUrl } from '../src/server/validation/business.schemas'
import { buildSystemPrompt } from '../src/server/ai/promptBuilder'
import { MockAiProvider } from '../src/server/ai/providers/mockAiProvider'
import { aiResultSchema } from '../src/server/ai/aiResult.schema'
import type { AiBusinessContext } from '../src/server/ai/types'

// ---------------------------------------------------------------------------
// MCR-3 — Pricing & Business Location Foundation: the one canonical reading
// of a service price, its customer-facing format, price conditions, the
// explicit inspection flag, the safe location link, and the AI contract that
// forbids invented prices / addresses.
// ---------------------------------------------------------------------------

const { repo } = vi.hoisted(() => ({ repo: { rows: [] as Record<string, any>[], updates: [] as unknown[] } }))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: {
    create: async (data: Record<string, unknown>) => ({ ...data, id: 'svc-new', isActive: true, createdAt: new Date(), updatedAt: new Date() }),
    findById: async (t: string, b: string, id: string) => repo.rows.find((r) => r.tenantId === t && r.businessId === b && r.id === id) ?? null,
    updateById: async (t: string, b: string, id: string, data: unknown) => {
      repo.updates.push(data)
      return { id, ...(data as object) }
    },
  },
}))

import { createService, updateService } from '../src/server/services/serviceCatalogService'

const plain = (s: string | null) => (s === null ? null : s.replace(/[  ]/g, ' '))
const decimal = (v: string) => ({ toString: () => v, toFixed: () => Number(v).toFixed(2) })

beforeEach(() => {
  repo.rows = []
  repo.updates = []
})

// ---------------------------------------------------------------------------
describe('A. canonical pricing semantics', () => {
  it.each([
    [15000, 15000, 'FIXED', '15 000 ₸', '15000.00', '15000.00'],
    [40000, null, 'FROM', 'от 40 000 ₸', '40000.00', null],
    [10000, 20000, 'RANGE', '10 000–20 000 ₸', '10000.00', '20000.00'],
    [null, null, 'UNAVAILABLE', null, null, null],
  ] as const)('from=%s to=%s → %s %s', (priceFrom, priceTo, type, formatted, min, max) => {
    const p = describeServicePricing({ priceFrom, priceTo, currency: 'KZT' })
    expect(p).toMatchObject({ type, min, max, currency: 'KZT' })
    expect(plain(p.formatted)).toBe(formatted)
  })

  it('reads Prisma Decimals (string form) the same way', () => {
    expect(describeServicePricing({ priceFrom: decimal('40000'), priceTo: null, currency: 'KZT' }).type).toBe('FROM')
  })

  it.each([
    ['"to" without "from"', null, 5000],
    ['inverted range', 20000, 10000],
    ['negative', -1, null],
    ['not a number', 'abc', null],
    ['infinite', Infinity, null],
  ])('malformed (%s) is never a customer claim → UNAVAILABLE, no number', (_label, priceFrom, priceTo) => {
    expect(describeServicePricing({ priceFrom: priceFrom as never, priceTo, currency: 'KZT' })).toEqual({ type: 'UNAVAILABLE', min: null, max: null, currency: 'KZT', formatted: null })
  })
})

describe('B. customer-facing formatting', () => {
  it('KZT fixed / from / range use ₸ with Russian grouping', () => {
    expect(plain(describeServicePricing({ priceFrom: 15000, priceTo: 15000, currency: 'KZT' }).formatted)).toBe('15 000 ₸')
    expect(plain(describeServicePricing({ priceFrom: 40000, priceTo: null, currency: 'KZT' }).formatted)).toBe('от 40 000 ₸')
    expect(plain(describeServicePricing({ priceFrom: 40000, priceTo: 60000, currency: 'KZT' }).formatted)).toBe('40 000–60 000 ₸')
  })

  it('other supported currencies keep their own symbol (never hard-coded to ₸)', () => {
    expect(plain(describeServicePricing({ priceFrom: 3000, priceTo: 5000, currency: 'RUB' }).formatted)).toBe('3 000–5 000 ₽')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('XYZ')).toBe('XYZ') // unknown → ISO code, never a wrong symbol
  })

  it('fractions only when non-zero', () => {
    expect(plain(formatAmount(1500))).toBe('1 500')
    expect(plain(formatAmount(1500.5))).toBe('1 500,50')
  })

  it('no configured price → no formatted text at all', () => {
    expect(describeServicePricing({ priceFrom: null, priceTo: null, currency: 'KZT' }).formatted).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('validation — pricing shape, price note, inspection flag', () => {
  const base = { name: 'Покраска капота', durationMinutes: 240 }

  it('accepts fixed, from, range and no price', () => {
    for (const p of [{ priceFrom: 15000, priceTo: 15000 }, { priceFrom: 40000 }, { priceFrom: 10000, priceTo: 20000 }, {}]) {
      expect(createServiceSchema.safeParse({ ...base, ...p }).success).toBe(true)
    }
  })

  it('rejects "to" without "from", an inverted range and negative prices', () => {
    const toOnly = createServiceSchema.safeParse({ ...base, priceTo: 5000 })
    expect(toOnly.success).toBe(false)
    expect(JSON.stringify(toOnly)).toContain(PRICE_TO_WITHOUT_FROM)
    expect(createServiceSchema.safeParse({ ...base, priceFrom: 20000, priceTo: 10000 }).success).toBe(false)
    expect(createServiceSchema.safeParse({ ...base, priceFrom: -1 }).success).toBe(false)
  })

  it('priceNote: optional, trimmed, "" → null, max 300', () => {
    expect(createServiceSchema.parse({ ...base, priceNote: '  За одну деталь  ' }).priceNote).toBe('За одну деталь')
    expect(updateServiceSchema.parse({ priceNote: '' }).priceNote).toBeNull()
    expect(createServiceSchema.safeParse({ ...base, priceNote: 'x'.repeat(301) }).success).toBe(false)
    expect(createServiceSchema.safeParse({ ...base, priceNote: 'x'.repeat(300) }).success).toBe(true)
  })

  it('requiresInspection must be a boolean', () => {
    expect(updateServiceSchema.safeParse({ requiresInspection: 'yes' }).success).toBe(false)
    expect(updateServiceSchema.parse({ requiresInspection: true }).requiresInspection).toBe(true)
  })
})

describe('service catalog — new fields stored, safe defaults, merged shape check', () => {
  it('create stores priceNote / requiresInspection; defaults are null / false (existing behaviour unchanged)', async () => {
    const ctx = makeAuthContext('owner')
    const withFields = await createService(ctx, { name: 'Покраска капота', durationMinutes: 240, priceFrom: 40000, priceNote: 'Цена зависит от состояния детали.', requiresInspection: true } as never)
    expect(withFields).toMatchObject({ priceNote: 'Цена зависит от состояния детали.', requiresInspection: true })
    const plainService = await createService(ctx, { name: 'Замена масла', durationMinutes: 60 } as never)
    expect(plainService).toMatchObject({ priceNote: null, requiresInspection: false })
  })

  it('a partial update cannot leave "to" without "from" (validated against the stored row)', async () => {
    repo.rows = [{ id: 's1', tenantId: 't1', businessId: 'b1', priceFrom: decimal('40000'), priceTo: null }]
    await expect(updateService(makeAuthContext('owner'), 's1', { priceFrom: null } as never)).resolves.toBeDefined() // from removed, no "to" → no price
    repo.rows = [{ id: 's2', tenantId: 't1', businessId: 'b1', priceFrom: null, priceTo: null, toNumber: undefined }]
    await expect(updateService(makeAuthContext('owner'), 's2', { priceTo: 5000 } as never)).rejects.toMatchObject({ statusCode: 400, message: PRICE_TO_WITHOUT_FROM })
  })

  it("tenant isolation: another tenant's service id is 404 and nothing is written", async () => {
    repo.rows = [{ id: 's1', tenantId: 't1', businessId: 'b1', priceFrom: null, priceTo: null }]
    const foreign = makeAuthContext('owner', { tenant: { ...makeAuthContext().tenant, id: 't2' } })
    await expect(updateService(foreign, 's1', { priceNote: 'чужое' } as never)).rejects.toMatchObject({ statusCode: 404 })
    expect(repo.updates).toEqual([])
  })

  it('manager cannot change prices or conditions', async () => {
    await expect(createService(makeAuthContext('manager'), { name: 'X услуга', durationMinutes: 60 } as never)).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ---------------------------------------------------------------------------
describe('location — safe http(s) link only', () => {
  it.each([
    'https://2gis.kz/almaty/firm/70000001012345678',
    'https://yandex.kz/maps/-/CDabcXYZ',
    'https://maps.google.com/?q=43.2389,76.8897',
    'http://example.kz/map',
  ])('accepts %s', (url) => {
    expect(isSafeLocationUrl(url)).toBe(true)
    expect(businessProfileSchema.parse({ locationUrl: url }).locationUrl).toBe(url)
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['ftp://example.kz/map'],
    ['2gis.kz/almaty'],
    ['https://'],
    ['https://exa mple.kz'],
    [`https://example.kz/${'a'.repeat(2000)}`],
  ])('rejects %j', (url) => {
    expect(isSafeLocationUrl(url)).toBe(false)
    expect(businessProfileSchema.safeParse({ locationUrl: url }).success).toBe(false)
  })

  it('"" clears the link (null); the address field is untouched by the link', () => {
    expect(businessProfileSchema.parse({ locationUrl: '' })).toEqual({ locationUrl: null })
    expect(businessProfileSchema.parse({ address: 'Алматы, ул. Тестовая, 1', locationUrl: 'https://2gis.kz/x' })).toEqual({
      address: 'Алматы, ул. Тестовая, 1',
      locationUrl: 'https://2gis.kz/x',
    })
  })
})

// ---------------------------------------------------------------------------
describe('E. AI safety contract (system prompt)', () => {
  const prompt = buildSystemPrompt('interactive')

  it('prices come only from services[].pricing, with each type preserved', () => {
    expect(prompt).toContain('единственный источник цены: services[].pricing')
    for (const fact of ['FIXED', 'FROM', 'RANGE', 'UNAVAILABLE', 'requiresInspection = true', 'priceNote']) expect(prompt).toContain(fact)
    expect(prompt).toContain('никогда не придумывай верхнюю границу')
  })

  it('Service price wins over Knowledge text; location only from address/locationUrl; useful answer first', () => {
    expect(prompt).toContain('верна цена из services')
    expect(prompt).toContain('business.address и business.locationUrl')
    expect(prompt).toContain('никогда не придумывай адрес')
    expect(prompt).toContain('Сначала польза, потом вопросы')
  })

  it('the same rules reach draft and qualify modes (they extend the base prompt)', () => {
    expect(buildSystemPrompt('draft')).toContain('единственный источник цены: services[].pricing')
    expect(buildSystemPrompt('qualify')).toContain('единственный источник цены: services[].pricing')
  })
})

// ---------------------------------------------------------------------------
function pricingOf(priceFrom: number | null, priceTo: number | null) {
  const { type, formatted, min, max } = describeServicePricing({ priceFrom, priceTo, currency: 'KZT' })
  return { type, formatted, min, max }
}
function ctxWith(overrides: Partial<AiBusinessContext> = {}): AiBusinessContext {
  return {
    business: { name: 'Проверка', description: null, phone: null, email: null, address: null, locationUrl: null, timezone: 'Asia/Almaty', currency: 'KZT' },
    currentDateTime: { date: '2026-10-05', time: '10:00', dayOfWeek: 'MONDAY' },
    workingHours: [],
    customerVehicles: [],
    services: [
      { id: 's1', name: 'Покраска капота', description: null, pricing: pricingOf(40000, null), priceNote: 'Цена зависит от состояния детали.', requiresInspection: true, currency: 'KZT', durationMinutes: 240 },
      { id: 's2', name: 'Полировка фар', description: null, pricing: pricingOf(null, null), priceNote: null, requiresInspection: false, currency: 'KZT', durationMinutes: 60 },
      { id: 's3', name: 'Диагностика подвески', description: null, pricing: pricingOf(10000, 20000), priceNote: null, requiresInspection: false, currency: 'KZT', durationMinutes: 60 },
    ],
    knowledge: [],
    rules: [],
    customer: null,
    vehicle: null,
    upcomingAppointments: [],
    serviceHistory: [],
    ...overrides,
  }
}
async function ask(message: string, context = ctxWith()) {
  const res = await new MockAiProvider().generate({ systemPrompt: 'x', userMessage: message, businessContext: context, history: [], tools: [], toolExchanges: [] } as never)
  return aiResultSchema.parse((res as { raw: unknown }).raw)
}

describe('E. AI behaviour on the facts (mock provider, deterministic)', () => {
  it('FROM stays "от", the condition and the inspection requirement are stated', async () => {
    const r = await ask('Сколько стоит покраска капота?')
    const text = plain(r.answer)!
    expect(text).toContain('от 40 000 ₸')
    expect(text).toContain('Цена зависит от состояния детали.')
    expect(text).not.toContain('..') // the configured note keeps its own punctuation
    expect(text).toContain('Точная стоимость подтверждается после осмотра.')
  })

  it('RANGE stays a range; requiresInspection=false never claims an inspection', async () => {
    const r = await ask('Сколько стоит диагностика подвески?')
    expect(plain(r.answer)).toContain('10 000–20 000 ₸')
    expect(r.answer).not.toContain('осмотр')
  })

  it('no configured price → no number at all', async () => {
    const r = await ask('Сколько стоит полировка фар?')
    expect(r.answer).not.toMatch(/\d/)
  })

  it('a different price in Knowledge never replaces the Service price', async () => {
    const context = ctxWith({ knowledge: [{ title: 'Покраска капота', content: 'Покраска капота стоит 5 000 ₸ по акции', category: 'FAQ' }] })
    const r = await ask('Сколько стоит покраска капота?', context)
    expect(plain(r.answer)).toContain('от 40 000 ₸')
    expect(r.answer).not.toContain('5 000')
  })

  it('price + location in one question → both configured facts, address and map link', async () => {
    const context = ctxWith({ business: { ...ctxWith().business, address: 'Алматы, ул. Тестовая, 1', locationUrl: 'https://2gis.kz/almaty/firm/1' } })
    const r = await ask('Сколько стоит покраска капота и где вы находитесь?', context)
    const text = plain(r.answer)!
    expect(text).toContain('от 40 000 ₸')
    expect(text).toContain('Алматы, ул. Тестовая, 1')
    expect(text).toContain('https://2gis.kz/almaty/firm/1')
  })

  it('no address and no link configured → no invented address or URL, handed to a human', async () => {
    const r = await ask('Где вы находитесь?')
    expect(r.answer).not.toMatch(/https?:\/\//)
    expect(r.answer).toContain('нет')
    expect(r.needsHuman).toBe(true)
  })

  it('address without a link → address only, never a fabricated map link', async () => {
    const context = ctxWith({ business: { ...ctxWith().business, address: 'Алматы, ул. Тестовая, 1' } })
    const r = await ask('Пришлите адрес', context)
    expect(r.answer).toContain('Алматы, ул. Тестовая, 1')
    expect(r.answer).not.toMatch(/https?:\/\//)
  })
})
