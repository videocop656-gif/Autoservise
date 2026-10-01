import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 53 — "Предложить ответ AI": generateConversationDraft and
// POST /api/conversations/:id/ai-draft. Real aiService (draft mode), real
// context builder, real tool registry + tools; repositories and the
// appointment/delivery side are mocked so every possible side effect is
// observable. The provider is injected (service tests) or the real
// MockAiProvider (handler tests, no OPENAI_API_KEY in tests).
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  convFindById: vi.fn(),
  listByConversation: vi.fn(),
  messageCreate: vi.fn(),
  serviceList: vi.fn(),
  knowledgeList: vi.fn(),
  ruleList: vi.fn(),
  customerFindById: vi.fn(),
  hoursList: vi.fn(),
  vehicleList: vi.fn(),
  checkAvailability: vi.fn(),
  createAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  escalationFindActive: vi.fn(),
  escalationCreate: vi.fn(),
  aiLogCreate: vi.fn(),
  getChannelAdapter: vi.fn(),
  deliveryClaim: vi.fn(),
  auth: { ctx: null as AuthContext | null },
}))

vi.mock('../src/server/repositories/conversationRepository', () => ({ conversationRepository: { findById: m.convFindById } }))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: { listByConversation: m.listByConversation, create: m.messageCreate },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({ serviceRepository: { listByBusiness: m.serviceList } }))
vi.mock('../src/server/repositories/knowledgeRepository', () => ({ knowledgeRepository: { listByBusiness: m.knowledgeList } }))
vi.mock('../src/server/repositories/businessRuleRepository', () => ({ businessRuleRepository: { listByBusiness: m.ruleList } }))
vi.mock('../src/server/repositories/customerRepository', () => ({ customerRepository: { findById: m.customerFindById } }))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: { findById: vi.fn(), list: m.vehicleList } }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: { findById: vi.fn() } }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { list: vi.fn() },
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
}))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({ serviceRecordRepository: { list: vi.fn() } }))
vi.mock('../src/server/repositories/workingHoursRepository', () => ({ workingHoursRepository: { listByBusiness: m.hoursList } }))
vi.mock('../src/server/services/appointmentService', () => ({
  checkAvailability: m.checkAvailability,
  createAppointment: m.createAppointment,
  updateAppointment: m.updateAppointment,
}))
vi.mock('../src/server/repositories/escalationRepository', () => ({
  escalationRepository: { findActiveByConversation: m.escalationFindActive, create: m.escalationCreate },
}))
vi.mock('../src/server/repositories/aiLogRepository', () => ({ aiLogRepository: { create: m.aiLogCreate } }))
// Sentinels: a draft must never reach the channel layer.
vi.mock('../src/server/channels/channelAdapterRegistry', () => ({ getChannelAdapter: m.getChannelAdapter }))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({ channelDeliveryRepository: { claimForSending: m.deliveryClaim } }))
vi.mock('../src/server/middleware/requireAuth', () => ({
  requireAuth: async () => {
    if (m.auth.ctx) return m.auth.ctx
    const { ApiError } = await import('../src/server/lib/errors')
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  },
}))

import { generateConversationDraft } from '../src/server/services/aiService'
import { AiProviderError, type AiProvider, type AiGenerationRequest, type AiGenerationResult } from '../src/server/ai/provider'
import { ApiError } from '../src/server/lib/errors'
import aiDraftHandler from '../api/conversations/[id]/ai-draft'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const CONV = '11111111-1111-4111-8111-111111111111'
const SERVICE = '33333333-3333-4333-8333-333333333333'
const CUSTOMER = '44444444-4444-4444-8444-444444444444'
const VEHICLE = '55555555-5555-4555-8555-555555555555'

const ctx = makeAuthContext('manager', { business: makeBusiness({ timezone: 'Europe/Moscow' }) })

function conversation(overrides: Record<string, unknown> = {}) {
  return { id: CONV, tenantId: 't1', businessId: 'b1', customerId: null, customerRequestId: null, status: 'OPEN', ...overrides }
}
let seq = 0
function msg(direction: 'INBOUND' | 'OUTBOUND', content: string) {
  seq++
  return { id: `m${seq}`, direction, senderType: direction === 'INBOUND' ? 'CUSTOMER' : 'STAFF', content, createdAt: new Date(2026, 8, 1, 10, seq) }
}

/** A provider that records every request and replays scripted generations. */
function scriptedProvider(...steps: AiGenerationResult[]) {
  const requests: AiGenerationRequest[] = []
  const provider: AiProvider = {
    async generate(request) {
      requests.push(structuredClone(request))
      return steps[Math.min(requests.length - 1, steps.length - 1)]!
    },
  }
  return { provider, requests }
}
const finalAnswer = (answer: string, needsHuman = false): AiGenerationResult => ({
  type: 'final',
  raw: {
    intent: 'PRICE_INQUIRY',
    confidence: 0.9,
    entities: { customerName: null, phone: null, vehicleMake: null, vehicleModel: null, licensePlate: null, serviceName: null, requestedDate: null, requestedTime: null },
    answer,
    needsHuman,
    reason: needsHuman ? 'Нужна консультация администратора' : null,
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  seq = 0
  m.auth.ctx = ctx
  m.convFindById.mockResolvedValue(conversation())
  m.listByConversation.mockResolvedValue([msg('INBOUND', 'Сколько стоит замена масла?')])
  m.serviceList.mockResolvedValue([
    { id: SERVICE, name: 'Замена масла', description: null, priceFrom: { toFixed: () => '5000.00' }, priceTo: null, currency: 'RUB', durationMinutes: 60 },
  ])
  m.knowledgeList.mockResolvedValue([{ title: 'Парковка', content: 'Есть парковка', category: 'FAQ' }])
  m.ruleList.mockResolvedValue([{ name: 'Предоплата', description: 'Без предоплаты', category: 'GENERAL', priority: 10 }])
  m.customerFindById.mockResolvedValue(null)
  m.hoursList.mockResolvedValue([
    { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
    { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
  ])
  m.checkAvailability.mockResolvedValue({ date: '2026-10-05', timezone: 'Europe/Moscow', slots: [] })
  m.escalationFindActive.mockResolvedValue(null)
  m.aiLogCreate.mockResolvedValue({})
  m.vehicleList.mockResolvedValue({ items: [], total: 0 })
})

function expectNoSideEffects() {
  expect(m.messageCreate).not.toHaveBeenCalled()
  expect(m.deliveryClaim).not.toHaveBeenCalled()
  expect(m.getChannelAdapter).not.toHaveBeenCalled()
  expect(m.createAppointment).not.toHaveBeenCalled()
  expect(m.updateAppointment).not.toHaveBeenCalled()
  expect(m.escalationCreate).not.toHaveBeenCalled()
}

describe('generateConversationDraft — real conversation context', () => {
  it('answers the latest customer message and returns the proposed reply text', async () => {
    const { provider, requests } = scriptedProvider(finalAnswer('Замена масла — от 5000 ₽.'))

    const result = await generateConversationDraft(ctx, CONV, { provider })

    expect(result).toEqual({ draft: 'Замена масла — от 5000 ₽.', needsHuman: false })
    expect(requests[0]!.userMessage).toBe('Сколько стоит замена масла?')
    expectNoSideEffects()
  })

  it('multi-turn: earlier messages are history, oldest first, customer vs staff kept apart; the latest is the user message', async () => {
    m.listByConversation.mockResolvedValue([
      msg('INBOUND', 'Сколько стоит замена масла?'),
      msg('OUTBOUND', 'От 5 000 ₽.'),
      msg('INBOUND', 'А завтра после 15 можно?'),
    ])
    const { provider, requests } = scriptedProvider(finalAnswer('Да, есть время.'))

    await generateConversationDraft(ctx, CONV, { provider })

    expect(requests[0]!.userMessage).toBe('А завтра после 15 можно?')
    expect(requests[0]!.history).toEqual([
      { direction: 'INBOUND', content: 'Сколько стоит замена масла?' },
      { direction: 'OUTBOUND', content: 'От 5 000 ₽.' },
    ])
  })

  it('history is bounded to the 20 messages before the latest one', async () => {
    const many = Array.from({ length: 30 }, (_, i) => msg(i % 2 ? 'OUTBOUND' : 'INBOUND', `сообщение ${i}`))
    many.push(msg('INBOUND', 'последнее'))
    m.listByConversation.mockResolvedValue(many)
    const { provider, requests } = scriptedProvider(finalAnswer('ok'))

    await generateConversationDraft(ctx, CONV, { provider })

    expect(requests[0]!.history).toHaveLength(20)
    expect(requests[0]!.history[0]!.content).toBe('сообщение 10')
    expect(requests[0]!.history[19]!.content).toBe('сообщение 29')
  })

  it('the business context carries today in the business timezone, the working hours, services, knowledge and rules', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T22:30:00Z')) // Sunday 22:30 UTC = Monday 01:30 in Moscow
    try {
      const { provider, requests } = scriptedProvider(finalAnswer('ok'))
      await generateConversationDraft(ctx, CONV, { provider })
      const context = requests[0]!.businessContext

      expect(context.currentDateTime).toEqual({ date: '2026-10-05', time: '01:30', dayOfWeek: 'MONDAY' })
      expect(context.workingHours).toEqual([
        { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
        { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
      ])
      expect(context.services.map((s) => s.name)).toEqual(['Замена масла'])
      expect(context.knowledge).toHaveLength(1)
      expect(context.rules).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('everything is read for the session tenant/business only', async () => {
    const { provider } = scriptedProvider(finalAnswer('ok'))
    await generateConversationDraft(ctx, CONV, { provider })

    expect(m.convFindById).toHaveBeenCalledWith('t1', 'b1', CONV)
    expect(m.listByConversation).toHaveBeenCalledWith('t1', 'b1', CONV)
    expect(m.serviceList).toHaveBeenCalledWith('t1', 'b1', true)
    expect(m.knowledgeList).toHaveBeenCalledWith('t1', 'b1', { activeOnly: true })
    expect(m.ruleList).toHaveBeenCalledWith('t1', 'b1', { activeOnly: true })
    expect(m.hoursList).toHaveBeenCalledWith('b1')
  })

  it('a linked customer is loaded tenant-scoped into the context', async () => {
    m.convFindById.mockResolvedValue(conversation({ customerId: CUSTOMER }))
    m.customerFindById.mockResolvedValue({ id: CUSTOMER, firstName: 'Иван', lastName: null, phone: '+7900', email: null })
    const { provider, requests } = scriptedProvider(finalAnswer('ok'))

    await generateConversationDraft(ctx, CONV, { provider })

    expect(m.customerFindById).toHaveBeenCalledWith('t1', 'b1', CUSTOMER)
    expect(requests[0]!.businessContext.customer).toMatchObject({ id: CUSTOMER, firstName: 'Иван' })
  })

  it('Prompt 54 — after intake, the draft sees the linked customer and their stored vehicles; still no mutation or send', async () => {
    m.convFindById.mockResolvedValue(conversation({ customerId: CUSTOMER }))
    m.customerFindById.mockResolvedValue({ id: CUSTOMER, firstName: 'Алексей', lastName: 'Смирнов', phone: '+79015554433', email: null })
    m.vehicleList.mockResolvedValue({ items: [{ id: VEHICLE, make: 'Toyota', model: 'Camry', year: 2021, licensePlate: 'K001KK77' }], total: 1 })
    const { provider, requests } = scriptedProvider(finalAnswer('Алексей, для Toyota Camry есть время завтра.'))

    await generateConversationDraft(ctx, CONV, { provider })

    const context = requests[0]!.businessContext
    expect(m.vehicleList).toHaveBeenCalledWith('t1', 'b1', expect.objectContaining({ customerId: CUSTOMER, activeOnly: true }))
    expect(context.customer).toMatchObject({ firstName: 'Алексей', lastName: 'Смирнов' })
    expect(context.customerVehicles).toEqual([{ make: 'Toyota', model: 'Camry', year: 2021, licensePlate: 'K001KK77' }])
    expect(context.vehicle).toBeNull() // no linked request → no selected vehicle
    expect(requests[0]!.systemPrompt).toContain('непроверенные слова клиента')
    expectNoSideEffects()
  })
})

describe('draft mode is read-only', () => {
  it('only check_availability is offered to the provider, and the prompt is in draft mode', async () => {
    const { provider, requests } = scriptedProvider(finalAnswer('ok'))
    await generateConversationDraft(ctx, CONV, { provider })

    expect(requests[0]!.tools.map((t) => t.name)).toEqual(['check_availability'])
    expect(requests[0]!.systemPrompt).toContain('РЕЖИМ ЧЕРНОВИКА')
  })

  it('read-only availability still runs through the canonical service', async () => {
    const { provider, requests } = scriptedProvider(
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'check_availability', arguments: { serviceId: SERVICE, date: '2026-10-05' } }] },
      finalAnswer('Завтра свободно в 15:00 и 16:00.')
    )

    const result = await generateConversationDraft(ctx, CONV, { provider })

    expect(m.checkAvailability).toHaveBeenCalledWith(ctx, expect.objectContaining({ serviceId: SERVICE, date: '2026-10-05' }))
    expect(requests[1]!.toolExchanges[0]!.result).toMatchObject({ success: true, tool: 'check_availability' })
    expect(result.draft).toBe('Завтра свободно в 15:00 и 16:00.')
    expectNoSideEffects()
  })

  it.each(['create_appointment', 'reschedule_appointment', 'cancel_appointment'])(
    'a %s request (even with an explicit "Да") is refused before execution — nothing is booked or changed',
    async (tool) => {
      m.convFindById.mockResolvedValue(conversation({ customerId: CUSTOMER }))
      m.listByConversation.mockResolvedValue([msg('INBOUND', 'Да, записывайте на 15:30')])
      const args = { customerId: CUSTOMER, vehicleId: VEHICLE, serviceId: SERVICE, appointmentId: VEHICLE, startAt: '2026-10-05T12:30:00Z', endAt: '2026-10-05T13:30:00Z' }
      const { provider, requests } = scriptedProvider(
        { type: 'tool_calls', calls: [{ id: 'c1', name: tool, arguments: args }] },
        finalAnswer('Спасибо! Администратор оформит запись.')
      )

      await generateConversationDraft(ctx, CONV, { provider })

      expect(requests[1]!.toolExchanges[0]!.result).toMatchObject({ success: false, errorCode: 'NOT_ALLOWED_IN_DRAFT', attempted: false })
      expectNoSideEffects()
    }
  )

  it('needsHuman never opens an escalation in draft mode — it is only returned to the operator', async () => {
    const { provider } = scriptedProvider(finalAnswer('Уточню у администратора.', true))

    const result = await generateConversationDraft(ctx, CONV, { provider })

    expect(result.needsHuman).toBe(true)
    expect(m.escalationFindActive).not.toHaveBeenCalled()
    expectNoSideEffects()
  })

  it('the run is audited as a draft (AiLog metadata mode=draft, outcome not ESCALATED)', async () => {
    const { provider } = scriptedProvider(finalAnswer('Уточню у администратора.', true))
    await generateConversationDraft(ctx, CONV, { provider })

    const analyzeLog = m.aiLogCreate.mock.calls.map((c) => c[0]).find((d) => d.operation === 'AI_ANALYZE')
    expect(analyzeLog).toMatchObject({ outcome: 'SUCCESS', metadata: expect.objectContaining({ mode: 'draft' }) })
  })
})

describe('failures and guards', () => {
  it('provider failure → same error code, Russian operator message, nothing created', async () => {
    const provider: AiProvider = { generate: async () => { throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'upstream 503 secret details') } }

    const err = await generateConversationDraft(ctx, CONV, { provider }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_UNAVAILABLE', message: 'Не удалось подготовить ответ AI. Попробуйте ещё раз.' })
    expectNoSideEffects()
  })

  it('an unusable model answer is an error, never a fake draft', async () => {
    const { provider } = scriptedProvider({ type: 'final', raw: { not: 'an AiResult' } })

    await expect(generateConversationDraft(ctx, CONV, { provider })).rejects.toMatchObject({ statusCode: 502, code: 'AI_DRAFT_UNAVAILABLE' })
  })

  it('no customer message to answer (empty conversation, or staff replied last) → 409, provider never called', async () => {
    const { provider, requests } = scriptedProvider(finalAnswer('x'))
    m.listByConversation.mockResolvedValue([])
    await expect(generateConversationDraft(ctx, CONV, { provider })).rejects.toMatchObject({ statusCode: 409, code: 'NO_CUSTOMER_MESSAGE' })

    m.listByConversation.mockResolvedValue([msg('INBOUND', 'Вопрос'), msg('OUTBOUND', 'Ответ')])
    await expect(generateConversationDraft(ctx, CONV, { provider })).rejects.toMatchObject({ statusCode: 409, code: 'NO_CUSTOMER_MESSAGE' })
    expect(requests).toHaveLength(0)
  })

  it('a closed conversation → 409', async () => {
    m.convFindById.mockResolvedValue(conversation({ status: 'CLOSED' }))
    await expect(generateConversationDraft(ctx, CONV, { provider: scriptedProvider(finalAnswer('x')).provider })).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONVERSATION_CLOSED',
    })
  })

  it("another tenant's conversation → 404 (the scoped lookup finds nothing)", async () => {
    m.convFindById.mockResolvedValue(null)
    const foreign = makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

    await expect(generateConversationDraft(foreign, CONV, { provider: scriptedProvider(finalAnswer('x')).provider })).rejects.toMatchObject({ statusCode: 404 })
    expect(m.convFindById).toHaveBeenCalledWith('t2', 'b2', CONV)
    expect(m.listByConversation).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// POST /api/conversations/:id/ai-draft — real handler + real MockAiProvider
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
async function call(method: string, id: string) {
  const res = makeRes()
  await aiDraftHandler({ method, headers: {}, query: { id }, body: undefined } as unknown as ApiRequest, res)
  return res
}

describe('POST /api/conversations/:id/ai-draft', () => {
  it('returns { draft, needsHuman } grounded in the business data (mock provider), with nothing created or sent', async () => {
    const res = await call('POST', CONV)

    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['draft', 'needsHuman'])
    expect(res.body.draft).toContain('5000')
    expectNoSideEffects()
  })

  it('a confirmation in the conversation does not book anything in draft mode (mock provider asks, server refuses)', async () => {
    m.convFindById.mockResolvedValue(conversation({ customerId: CUSTOMER }))
    m.customerFindById.mockResolvedValue({ id: CUSTOMER, firstName: 'Иван', lastName: null, phone: '+7900', email: null })
    m.listByConversation.mockResolvedValue([msg('INBOUND', 'Да, подтверждаю 15:30')])

    const res = await call('POST', CONV)

    expect(res.statusCode).toBe(200)
    expectNoSideEffects()
  })

  it('unauthenticated → 401; wrong method → 405; malformed id → 404', async () => {
    m.auth.ctx = null
    expect((await call('POST', CONV)).statusCode).toBe(401)
    m.auth.ctx = ctx
    expect((await call('GET', CONV)).statusCode).toBe(405)
    expect((await call('POST', 'not-a-uuid')).statusCode).toBe(404)
    expect(m.messageCreate).not.toHaveBeenCalled()
  })

  it('never leaks provider internals: no prompt, tool trace or reason in the response', async () => {
    const res = await call('POST', CONV)
    const json = JSON.stringify(res.body)
    expect(json).not.toContain('systemPrompt')
    expect(json).not.toContain('toolExecutions')
    expect(json).not.toContain('reason')
  })
})
