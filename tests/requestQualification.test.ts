import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 55 — AI-assisted request qualification. Real requestQualificationService,
// real aiService ('qualify' mode), real context builder, real Prompt 49 bridge
// and real updateCustomerRequest, on an in-memory store. Sentinels prove that
// nothing is sent, booked or escalated. The provider is injected (service
// tests) or the real MockAiProvider (handler tests; no OPENAI_API_KEY).
// ---------------------------------------------------------------------------

type Row = Record<string, any> & { id: string; tenantId: string; businessId: string }

const s = vi.hoisted(() => ({
  db: { conversations: [] as Row[], messages: [] as Row[], customers: [] as Row[], vehicles: [] as Row[], services: [] as Row[], requests: [] as Row[], histories: [] as Row[] },
  spies: {
    messageCreate: (() => {}) as (...a: unknown[]) => void,
  },
  auth: { ctx: null as AuthContext | null },
}))
const { db, auth } = s
const sentinel = vi.hoisted(() => ({
  messageCreate: vi.fn(),
  deliveryClaim: vi.fn(),
  getChannelAdapter: vi.fn(),
  createAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  checkAvailability: vi.fn(),
  escalationCreate: vi.fn(),
  escalationFindActive: vi.fn(),
  aiLogCreate: vi.fn(),
}))

let seq = 0
const uuid = (p: string) => `${p}-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)
const find = (rows: Row[], t: string, b: string, id: string) => scoped(rows, t, b).find((r) => r.id === id) ?? null

vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(s.db)
    const tx = { customerRequest: { findFirst: async ({ where }: any) => find(s.db.requests, where.tenantId, where.businessId, where.id) } }
    try {
      return await fn(tx)
    } catch (err) {
      Object.assign(s.db, snapshot)
      throw err
    }
  },
}))
vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: {
    findById: async (t: string, b: string, id: string) => {
      const r = find(s.db.conversations, t, b, id)
      return r ? { ...r } : null
    },
    findByIdForUpdate: async (t: string, b: string, id: string) => {
      const r = find(s.db.conversations, t, b, id)
      return r ? { ...r } : null
    },
    linkCustomerRequest: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      const r = scoped(s.db.conversations, t, b).find((c) => c.id === id && c.customerRequestId === null)
      if (!r) return null
      Object.assign(r, data)
      return { ...r }
    },
  },
}))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: {
    listByConversation: async (t: string, b: string, id: string) => scoped(s.db.messages, t, b).filter((m) => m.conversationId === id),
    create: sentinel.messageCreate,
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: async (t: string, b: string, id: string) => find(s.db.customers, t, b, id) },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: {
    findById: async (t: string, b: string, id: string) => find(s.db.vehicles, t, b, id),
    list: async (t: string, b: string, o: { activeOnly: boolean; customerId?: string }) => {
      const items = scoped(s.db.vehicles, t, b).filter((v) => (!o.activeOnly || v.isActive) && (!o.customerId || v.customerId === o.customerId))
      return { items, total: items.length }
    },
  },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: {
    findById: async (t: string, b: string, id: string) => find(s.db.services, t, b, id),
    listByBusiness: async (t: string, b: string, activeOnly: boolean) => scoped(s.db.services, t, b).filter((x) => !activeOnly || x.isActive),
  },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: async (t: string, b: string, id: string) => {
      const r = find(s.db.requests, t, b, id)
      return r ? { ...r } : null
    },
    createWithInitialHistory: async (data: Row) => {
      const row = { ...data, id: uuid('rrrrrrrr-rrrr'), createdAt: new Date(), updatedAt: new Date() }
      s.db.requests.push(row)
      return { ...row }
    },
    updateById: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      const r = find(s.db.requests, t, b, id)
      if (!r) return null
      Object.assign(r, data, { updatedAt: new Date(r.updatedAt.getTime() + 1000) })
      return { ...r }
    },
    updateWithStatusHistory: vi.fn(),
  },
}))
vi.mock('../src/server/repositories/knowledgeRepository', () => ({ knowledgeRepository: { listByBusiness: async () => [] } }))
vi.mock('../src/server/repositories/businessRuleRepository', () => ({ businessRuleRepository: { listByBusiness: async () => [] } }))
vi.mock('../src/server/repositories/workingHoursRepository', () => ({ workingHoursRepository: { listByBusiness: async () => [] } }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { list: async () => ({ items: [], total: 0 }), findById: async () => null },
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
}))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({ serviceRecordRepository: { list: async () => ({ items: [], total: 0 }) } }))
vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({ serviceFollowUpRepository: { markBookedByCustomerRequest: async () => 0 } }))
vi.mock('../src/server/repositories/escalationRepository', () => ({
  escalationRepository: { findActiveByConversation: sentinel.escalationFindActive, create: sentinel.escalationCreate },
}))
vi.mock('../src/server/repositories/aiLogRepository', () => ({ aiLogRepository: { create: sentinel.aiLogCreate } }))
vi.mock('../src/server/services/appointmentService', () => ({
  createAppointment: sentinel.createAppointment,
  updateAppointment: sentinel.updateAppointment,
  checkAvailability: sentinel.checkAvailability,
}))
vi.mock('../src/server/channels/channelAdapterRegistry', () => ({ getChannelAdapter: sentinel.getChannelAdapter }))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({ channelDeliveryRepository: { claimForSending: sentinel.deliveryClaim } }))
vi.mock('../src/server/middleware/requireAuth', () => ({
  requireAuth: async () => {
    if (s.auth.ctx) return s.auth.ctx
    const { ApiError } = await import('../src/server/lib/errors')
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  },
}))

import { analyzeRequestQualification, applyRequestQualification } from '../src/server/services/requestQualificationService'
import { EMPTY_AI_ENTITIES } from '../src/server/ai/types'
import type { AiProvider, AiGenerationRequest, AiGenerationResult } from '../src/server/ai/provider'
import qualificationHandler from '../api/conversations/[id]/qualification'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const ctx = makeAuthContext('manager', { business: makeBusiness({ timezone: 'Europe/Moscow' }) })
const foreign = makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

const CONV = '11111111-1111-4111-8111-111111111111'
const CONV_NO_CUSTOMER = '12111111-1111-4111-8111-111111111111'
const CONV_WITH_REQUEST = '13111111-1111-4111-8111-111111111111'
const ALICE = '21111111-1111-4111-8111-111111111111'
const BORIS = '22111111-1111-4111-8111-111111111111'
const KIA = '31111111-1111-4111-8111-111111111111'
const LADA = '32111111-1111-4111-8111-111111111111'
const BORIS_CAR = '33111111-1111-4111-8111-111111111111'
const FOREIGN_CAR = '34111111-1111-4111-8111-111111111111'
const OIL = '41111111-1111-4111-8111-111111111111'
const BRAKES = '42111111-1111-4111-8111-111111111111'
const OLD_SERVICE = '43111111-1111-4111-8111-111111111111'
const FOREIGN_SERVICE = '44111111-1111-4111-8111-111111111111'
const REQUEST = '51111111-1111-4111-8111-111111111111'

function addMessage(conversationId: string, direction: 'INBOUND' | 'OUTBOUND', content: string) {
  s.db.messages.push({ id: uuid('mmmmmmmm-mmmm'), tenantId: 't1', businessId: 'b1', conversationId, direction, content, createdAt: new Date() })
}

const final = (entities: Partial<typeof EMPTY_AI_ENTITIES>, answer = 'Клиент просит заменить масло.', extra: Record<string, unknown> = {}): AiGenerationResult => ({
  type: 'final',
  raw: { intent: 'BOOKING_REQUEST', confidence: 0.8, entities: { ...EMPTY_AI_ENTITIES, ...entities }, answer, needsHuman: false, reason: null, ...extra },
})
function scripted(...steps: AiGenerationResult[]) {
  const requests: AiGenerationRequest[] = []
  const provider: AiProvider = {
    async generate(request) {
      requests.push(structuredClone(request))
      return steps[Math.min(requests.length - 1, steps.length - 1)]!
    },
  }
  return { provider, requests }
}

beforeEach(() => {
  seq = 0
  vi.clearAllMocks()
  s.auth.ctx = ctx
  sentinel.aiLogCreate.mockResolvedValue({})
  sentinel.escalationFindActive.mockResolvedValue(null)
  const own = { tenantId: 't1', businessId: 'b1' }
  s.db.customers = [
    { ...own, id: ALICE, firstName: 'Алиса', lastName: 'Иванова', phone: '+79001112233', email: null, isActive: true },
    { ...own, id: BORIS, firstName: 'Борис', lastName: null, phone: '+79002223344', email: null, isActive: true },
  ]
  s.db.vehicles = [
    { ...own, id: KIA, customerId: ALICE, make: 'Kia', model: 'Rio', year: 2019, licensePlate: 'A123BC77', isActive: true },
    { ...own, id: LADA, customerId: ALICE, make: 'Lada', model: 'Vesta', year: 2020, licensePlate: null, isActive: true },
    { ...own, id: BORIS_CAR, customerId: BORIS, make: 'Toyota', model: 'Camry', year: 2021, licensePlate: null, isActive: true },
    { tenantId: 't2', businessId: 'b2', id: FOREIGN_CAR, customerId: 'x', make: 'Kia', model: 'Rio', year: 2019, licensePlate: null, isActive: true },
  ]
  s.db.services = [
    { ...own, id: OIL, name: 'Замена масла', isActive: true, durationMinutes: 60, priceFrom: null, priceTo: null, currency: 'RUB', description: null },
    { ...own, id: BRAKES, name: 'Замена тормозных колодок', isActive: true, durationMinutes: 90, priceFrom: null, priceTo: null, currency: 'RUB', description: null },
    { ...own, id: OLD_SERVICE, name: 'Шиномонтаж', isActive: false, durationMinutes: 30, priceFrom: null, priceTo: null, currency: 'RUB', description: null },
    { tenantId: 't2', businessId: 'b2', id: FOREIGN_SERVICE, name: 'Замена масла', isActive: true, durationMinutes: 60 },
  ]
  s.db.requests = [
    { ...own, id: REQUEST, customerId: ALICE, vehicleId: null, serviceId: null, appointmentId: null, status: 'IN_PROGRESS', subject: 'Старое обращение', description: 'было', requestedDate: null, requestedTimeFrom: null, requestedTimeTo: null, updatedAt: new Date('2026-10-01T10:00:00Z') },
  ]
  s.db.conversations = [
    { ...own, id: CONV, customerId: ALICE, customerRequestId: null, status: 'OPEN', channel: 'TELEGRAM' },
    { ...own, id: CONV_NO_CUSTOMER, customerId: null, customerRequestId: null, status: 'OPEN', channel: 'TELEGRAM' },
    { ...own, id: CONV_WITH_REQUEST, customerId: ALICE, customerRequestId: REQUEST, status: 'OPEN', channel: 'TELEGRAM' },
  ]
  s.db.messages = []
  addMessage(CONV, 'INBOUND', 'Здравствуйте!')
  addMessage(CONV, 'OUTBOUND', 'Добрый день, чем помочь?')
  addMessage(CONV, 'INBOUND', 'Нужно поменять масло на Kia Rio, можно завтра после 15?')
  addMessage(CONV_NO_CUSTOMER, 'INBOUND', 'Меня зовут Пётр, у меня Camry 2021')
  addMessage(CONV_WITH_REQUEST, 'INBOUND', 'И ещё колодки посмотрите')
})

function expectNoSideEffects() {
  expect(sentinel.messageCreate).not.toHaveBeenCalled()
  expect(sentinel.deliveryClaim).not.toHaveBeenCalled()
  expect(sentinel.getChannelAdapter).not.toHaveBeenCalled()
  expect(sentinel.createAppointment).not.toHaveBeenCalled()
  expect(sentinel.updateAppointment).not.toHaveBeenCalled()
  expect(sentinel.checkAvailability).not.toHaveBeenCalled()
  expect(sentinel.escalationCreate).not.toHaveBeenCalled()
}

describe('analyze — the AI proposal (nothing written)', () => {
  it('runs the canonical core in qualify mode on the latest customer message with prior history, no tools offered', async () => {
    const { provider, requests } = scripted(final({ serviceName: 'Замена масла', vehicleMake: 'Kia', vehicleModel: 'Rio' }))
    await analyzeRequestQualification(ctx, CONV, { provider })

    expect(requests[0]!.mode).toBe('qualify')
    expect(requests[0]!.tools).toEqual([])
    expect(requests[0]!.userMessage).toBe('Нужно поменять масло на Kia Rio, можно завтра после 15?')
    expect(requests[0]!.history.map((h) => h.direction)).toEqual(['INBOUND', 'OUTBOUND'])
    expect(requests[0]!.systemPrompt).toContain('РЕЖИМ РАЗБОРА ОБРАЩЕНИЯ')
    expect(requests[0]!.businessContext.customerVehicles.map((v) => v.model)).toEqual(['Rio', 'Vesta'])
  })

  it('resolves the active service by exact name and the stored vehicle the customer named; no request is created', async () => {
    const { provider } = scripted(final({ serviceName: 'замена МАСЛА', vehicleMake: 'Kia', vehicleModel: 'Rio' }))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })

    expect(q.customer).toMatchObject({ status: 'linked', id: ALICE, name: 'Алиса Иванова' })
    expect(q.service).toMatchObject({ status: 'matched', serviceId: OIL })
    expect(q.vehicle).toMatchObject({ status: 'matched', vehicleId: KIA })
    expect(q.subject).toBe('Замена масла')
    expect(q.description).toBe('Клиент просит заменить масло.')
    expect(q.serviceOptions.map((o) => o.id).sort()).toEqual([OIL, BRAKES].sort()) // active, this business only
    expect(q.vehicleOptions.map((o) => o.id)).toEqual([KIA, LADA])
    expect(s.db.requests).toHaveLength(1)
    expectNoSideEffects()
  })

  it('the linked customer is authoritative — a name the model "found" never replaces it', async () => {
    const { provider } = scripted(final({ customerName: 'Пётр', phone: '+79990000000' }))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })
    expect(q.customer).toMatchObject({ status: 'linked', id: ALICE })
  })

  it('a vehicle only mentioned in chat stays unverified and is never created', async () => {
    const { provider } = scripted(final({ vehicleMake: 'Toyota', vehicleModel: 'Camry 2021' }))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })

    expect(q.vehicle).toEqual({ status: 'unverified', vehicleId: null, mention: 'Toyota Camry 2021' })
    expect(q.missing.some((m) => m.includes('не сохранён'))).toBe(true)
    expect(s.db.vehicles).toHaveLength(4)
  })

  it('two stored vehicles and no clear mention → ambiguous, nothing guessed', async () => {
    const { provider } = scripted(final({}))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })
    expect(q.vehicle).toMatchObject({ status: 'ambiguous', vehicleId: null })
    expect(q.missing).toContain('Нужно выбрать автомобиль — у клиента их несколько.')
  })

  it('an inactive, unknown, foreign or invented service never resolves to an id', async () => {
    for (const name of ['Шиномонтаж', 'Чистка инжектора', FOREIGN_SERVICE, OIL]) {
      const { provider } = scripted(final({ serviceName: name }))
      const q = await analyzeRequestQualification(ctx, CONV, { provider })
      expect(q.service).toMatchObject({ status: 'unresolved', serviceId: null })
      expect(q.missing).toContain('Услуга требует уточнения.')
    }
  })

  it('a definitive diagnosis in the AI description is rejected by the safety layer — the operator fills it', async () => {
    const { provider } = scripted(final({}, 'У вас точно неисправность в тормозной системе.'))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })
    expect(q.description).toBeNull()
    expect(q.missing).toContain('Описание не сформировано автоматически — заполните его вручную.')
  })

  it('timing: a valid future business-local date and HH:mm are kept; impossible, past or malformed ones are dropped with a note', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T22:30:00Z')) // Monday 01:30 in Moscow
    try {
      let q = await analyzeRequestQualification(ctx, CONV, { provider: scripted(final({ requestedDate: '2026-10-06', requestedTime: '15:00' })).provider })
      expect(q.timing).toMatchObject({ requestedDate: '2026-10-06', requestedTimeFrom: '15:00', notes: [] })

      q = await analyzeRequestQualification(ctx, CONV, { provider: scripted(final({ requestedDate: '2026-02-30', requestedTime: '25:00' })).provider })
      expect(q.timing).toMatchObject({ requestedDate: null, requestedTimeFrom: null })
      expect(q.timing.notes).toEqual(['Дата из сообщения не распознана.', 'Время из сообщения не распознано.'])

      q = await analyzeRequestQualification(ctx, CONV, { provider: scripted(final({ requestedDate: '2026-10-04' })).provider })
      expect(q.timing.requestedDate).toBeNull() // Sunday is already "yesterday" in Moscow
      expect(q.timing.notes).toEqual(['Дата из сообщения уже прошла.'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('no linked customer → "Клиент не определён" with message-derived (unverified) name; nothing linked or created', async () => {
    const { provider } = scripted(final({ customerName: 'Пётр', vehicleModel: 'Camry 2021' }))
    const q = await analyzeRequestQualification(ctx, CONV_NO_CUSTOMER, { provider })

    expect(q.customer).toEqual({ status: 'missing', mentionedName: 'Пётр', mentionedPhone: null })
    expect(q.vehicle).toMatchObject({ status: 'no_customer', vehicleId: null, mention: 'Camry 2021' })
    expect(q.missing[0]).toContain('Клиент не связан с диалогом')
    expect(s.db.conversations.find((c) => c.id === CONV_NO_CUSTOMER)!.customerId).toBeNull()
  })

  it('with a linked request: its vehicle/service/subject are kept as the starting point', async () => {
    s.db.requests[0]!.serviceId = BRAKES
    s.db.requests[0]!.vehicleId = LADA
    const q = await analyzeRequestQualification(ctx, CONV_WITH_REQUEST, { provider: scripted(final({ serviceName: 'Замена масла' })).provider })

    expect(q.basedOn).toEqual({ customerId: ALICE, customerRequestId: REQUEST, requestUpdatedAt: '2026-10-01T10:00:00.000Z' })
    expect(q.service).toMatchObject({ status: 'request', serviceId: BRAKES })
    expect(q.vehicle).toMatchObject({ status: 'request', vehicleId: LADA })
    expect(q.subject).toBe('Старое обращение')
  })

  it('a provider that asks for a mutating tool anyway gets refused — nothing executes', async () => {
    const { provider, requests } = scripted(
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'create_appointment', arguments: { customerId: ALICE } }] },
      final({})
    )
    await analyzeRequestQualification(ctx, CONV, { provider })
    expect(requests[1]!.toolExchanges[0]!.result).toMatchObject({ success: false, errorCode: 'NOT_ALLOWED_IN_DRAFT', attempted: false })
    expectNoSideEffects()
  })

  it('needsHuman never opens an escalation here; the run is audited as qualify', async () => {
    const { provider } = scripted(final({}, 'Клиент спрашивает о гарантии.', { needsHuman: true, reason: 'нужен человек' }))
    const q = await analyzeRequestQualification(ctx, CONV, { provider })
    expect(q.needsHuman).toBe(true)
    expectNoSideEffects()
    const log = sentinel.aiLogCreate.mock.calls.map((c) => c[0]).find((d: any) => d.operation === 'AI_ANALYZE')
    expect(log).toMatchObject({ metadata: expect.objectContaining({ mode: 'qualify' }) })
  })

  it('malformed model output → a safe error, never a half-trusted proposal', async () => {
    await expect(analyzeRequestQualification(ctx, CONV, { provider: scripted({ type: 'final', raw: { nope: true } }).provider })).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_QUALIFICATION_UNAVAILABLE',
    })
  })

  it("another tenant's conversation → 404; a conversation without customer messages → 409", async () => {
    await expect(analyzeRequestQualification(foreign, CONV, { provider: scripted(final({})).provider })).rejects.toMatchObject({ statusCode: 404 })
    s.db.messages = s.db.messages.filter((m) => m.conversationId !== CONV || m.direction === 'OUTBOUND')
    await expect(analyzeRequestQualification(ctx, CONV, { provider: scripted(final({})).provider })).rejects.toMatchObject({ statusCode: 409, code: 'NO_CUSTOMER_MESSAGE' })
  })
})

describe('apply — operator-confirmed persistence', () => {
  const reviewed = (o: Record<string, unknown> = {}) => ({
    action: 'create' as const,
    expectedCustomerId: ALICE,
    vehicleId: KIA,
    serviceId: OIL,
    subject: 'Замена масла',
    description: 'Клиент просит заменить масло.',
    requestedDate: '2026-10-06',
    requestedTimeFrom: '15:00',
    requestedTimeTo: null,
    ...o,
  })

  it('create goes through the Prompt 49 bridge: NEW request, timing stored, linked to the conversation, no appointment', async () => {
    const { request, created } = await applyRequestQualification(ctx, CONV, reviewed() as never)

    expect(created).toBe(true)
    expect(request).toMatchObject({ customerId: ALICE, vehicleId: KIA, serviceId: OIL, status: 'NEW', appointmentId: null, requestedTimeFrom: '15:00', source: 'OTHER' })
    expect(request.requestedDate!.toISOString()).toBe('2026-10-06T00:00:00.000Z') // business-local day
    expect(s.db.conversations.find((c) => c.id === CONV)!.customerRequestId).toBe(request.id)
    expect(sentinel.createAppointment).not.toHaveBeenCalled()
  })

  it('create refuses ids from another tenant or another customer (existing request rules)', async () => {
    await expect(applyRequestQualification(ctx, CONV, reviewed({ serviceId: FOREIGN_SERVICE }) as never)).rejects.toMatchObject({ statusCode: 404, message: 'Услуга не найдена' })
    await expect(applyRequestQualification(ctx, CONV, reviewed({ vehicleId: FOREIGN_CAR }) as never)).rejects.toMatchObject({ statusCode: 404, message: 'Автомобиль не найден' })
    await expect(applyRequestQualification(ctx, CONV, reviewed({ vehicleId: BORIS_CAR }) as never)).rejects.toMatchObject({ statusCode: 400, message: 'Автомобиль не принадлежит выбранному клиенту' })
    await expect(applyRequestQualification(ctx, CONV, reviewed({ serviceId: OLD_SERVICE }) as never)).rejects.toMatchObject({ statusCode: 400, message: 'Услуга неактивна — выберите другую' })
    expect(s.db.requests).toHaveLength(1)
    expect(s.db.conversations.find((c) => c.id === CONV)!.customerRequestId).toBeNull()
  })

  it('stale state → 409, nothing written: customer changed, or a request got linked meanwhile', async () => {
    await expect(applyRequestQualification(ctx, CONV, reviewed({ expectedCustomerId: BORIS }) as never)).rejects.toMatchObject({ statusCode: 409, code: 'QUALIFICATION_STALE' })
    s.db.conversations.find((c) => c.id === CONV)!.customerRequestId = REQUEST
    await expect(applyRequestQualification(ctx, CONV, reviewed() as never)).rejects.toMatchObject({ statusCode: 409, code: 'QUALIFICATION_STALE' })
    expect(s.db.requests).toHaveLength(1)
  })

  it('create without a linked customer → 409 (identity is the Prompt 54 workflow)', async () => {
    await expect(applyRequestQualification(ctx, CONV_NO_CUSTOMER, reviewed({ expectedCustomerId: null, vehicleId: null }) as never)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONVERSATION_HAS_NO_CUSTOMER',
    })
  })

  const update = (o: Record<string, unknown> = {}) =>
    reviewed({ action: 'update', expectedRequestId: REQUEST, expectedRequestUpdatedAt: '2026-10-01T10:00:00.000Z', subject: 'Старое обращение', ...o })

  it('update changes only the reviewed fields of the linked request — no duplicate, customer and status untouched', async () => {
    const { request, created } = await applyRequestQualification(ctx, CONV_WITH_REQUEST, update({ vehicleId: LADA, serviceId: BRAKES, description: 'Скрип при торможении.' }) as never)

    expect(created).toBe(false)
    expect(s.db.requests).toHaveLength(1)
    expect(request).toMatchObject({ id: REQUEST, customerId: ALICE, status: 'IN_PROGRESS', vehicleId: LADA, serviceId: BRAKES, description: 'Скрип при торможении.', requestedTimeFrom: '15:00' })
    expect(s.db.conversations.find((c) => c.id === CONV_WITH_REQUEST)!.customerRequestId).toBe(REQUEST)
  })

  it('update refuses a stale request version or a different request', async () => {
    await expect(applyRequestQualification(ctx, CONV_WITH_REQUEST, update({ expectedRequestUpdatedAt: '2026-09-30T10:00:00.000Z' }) as never)).rejects.toMatchObject({ statusCode: 409, code: 'QUALIFICATION_STALE' })
    await expect(applyRequestQualification(ctx, CONV_WITH_REQUEST, update({ expectedRequestId: CONV }) as never)).rejects.toMatchObject({ statusCode: 409, code: 'QUALIFICATION_STALE' })
    expect(s.db.requests[0]!.description).toBe('было')
  })

  it('a finished request is never edited from a qualification', async () => {
    s.db.requests[0]!.status = 'CONVERTED'
    await expect(applyRequestQualification(ctx, CONV_WITH_REQUEST, update() as never)).rejects.toMatchObject({ statusCode: 409, code: 'REQUEST_FINISHED' })
  })

  it('update refuses a vehicle of another customer (existing request rules)', async () => {
    await expect(applyRequestQualification(ctx, CONV_WITH_REQUEST, update({ vehicleId: BORIS_CAR }) as never)).rejects.toMatchObject({ statusCode: 400 })
    expect(s.db.requests[0]!.vehicleId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// POST /api/conversations/:id/qualification — real handler + real MockAiProvider
// ---------------------------------------------------------------------------

function makeRes() {
  const res = { statusCode: 0, body: undefined as any } as { statusCode: number; body: any } & ApiResponse
  res.status = vi.fn((code: number) => {
    res.statusCode = code
    return res
  }) as never
  res.json = vi.fn((data: unknown) => {
    res.body = data
  }) as never
  return res
}
async function call(id: string, body: unknown, method = 'POST') {
  const res = makeRes()
  await qualificationHandler({ method, headers: {}, query: { id }, body } as unknown as ApiRequest, res)
  return res
}

describe('POST /api/conversations/:id/qualification (mock provider end-to-end)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T09:00:00Z')) // Monday 12:00 in Moscow
  })
  afterEach(() => vi.useRealTimers())

  it('analyze → service, stored vehicle, tomorrow after 15 — all from the real conversation; nothing written', async () => {
    const res = await call(CONV, { action: 'analyze' })

    expect(res.statusCode).toBe(200)
    expect(res.body.qualification).toMatchObject({
      customer: { status: 'linked', id: ALICE },
      service: { status: 'matched', serviceId: OIL },
      vehicle: { status: 'matched', vehicleId: KIA },
      timing: { requestedDate: '2026-10-06', requestedTimeFrom: '15:00' },
    })
    expect(res.body.qualification.description).toContain('Клиент пишет')
    expect(s.db.requests).toHaveLength(1)
    expectNoSideEffects()
  })

  it('"что-то стучит спереди" → no service forced, no diagnosis, clarification needed', async () => {
    s.db.messages.push({ id: 'm-x', tenantId: 't1', businessId: 'b1', conversationId: CONV, direction: 'INBOUND', content: 'Что-то стучит спереди', createdAt: new Date() })
    s.db.messages = s.db.messages.filter((m) => m.conversationId !== CONV || m.id === 'm-x')
    const res = await call(CONV, { action: 'analyze' })

    expect(res.body.qualification.service).toMatchObject({ status: 'unresolved', serviceId: null })
    expect(res.body.qualification.missing).toContain('Услуга требует уточнения.')
    expect(res.body.qualification.description).toBe('Клиент пишет: «Что-то стучит спереди»')
  })

  it('create from the reviewed proposal → 201 with the linked request', async () => {
    const res = await call(CONV, { action: 'create', expectedCustomerId: ALICE, vehicleId: KIA, serviceId: OIL, subject: 'Замена масла', requestedDate: '2026-10-06', requestedTimeFrom: '15:00' })
    expect(res.statusCode).toBe(201)
    expect(res.body.customerRequest).toMatchObject({ customerId: ALICE, serviceId: OIL, vehicleId: KIA, status: 'NEW' })
  })

  it('401 without a session; 400 for a malformed body; 405 for GET; no customerRequestId can be passed', async () => {
    s.auth.ctx = null
    expect((await call(CONV, { action: 'analyze' })).statusCode).toBe(401)
    s.auth.ctx = ctx
    expect((await call(CONV, { action: 'book' })).statusCode).toBe(400)
    expect((await call(CONV, { action: 'create', expectedCustomerId: ALICE, subject: 'x' })).statusCode).toBe(400) // subject too short
    expect((await call(CONV, {}, 'GET')).statusCode).toBe(405)
    const res = await call(CONV, { action: 'create', expectedCustomerId: ALICE, subject: 'Замена масла', customerRequestId: REQUEST, customerId: BORIS })
    expect(res.statusCode).toBe(201)
    expect(res.body.customerRequest.customerId).toBe(ALICE) // customer from the conversation, never the body
    expect(res.body.customerRequest.id).not.toBe(REQUEST)
  })
})
