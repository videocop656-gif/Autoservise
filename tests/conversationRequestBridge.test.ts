import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Prompt 49 — Conversation → CustomerRequest bridge.
//
// Repositories run on a small in-memory store and runInTransaction is a
// faithful model of a DB transaction: it snapshots the store and RESTORES it
// if the callback throws (real rollback of everything written through tx),
// and runs transactions one at a time — what PostgreSQL's SELECT … FOR
// UPDATE on the conversation row guarantees for concurrent calls (the real
// lock query is covered in tenantIsolation.test.ts and was exercised against
// Supabase — see final-report-49.md). The real bridge service and the real
// CustomerRequest validation (prepareCustomerRequestCreate) run on top.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string; tenantId: string; businessId: string }

const { db, fail, TX } = vi.hoisted(() => {
  const db = {
    conversations: [] as Row[],
    requests: [] as Row[],
    histories: [] as Row[],
    customers: [] as Row[],
    vehicles: [] as Row[],
    services: [] as Row[],
  }
  const fail = { conversationUpdate: false, requestInsert: false }
  const TX = { __tx: true } as Record<string, unknown>
  return { db, fail, TX }
})

let seq = 0
const newId = (p: string) => `${p}-${++seq}`
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)

let chain: Promise<unknown> = Promise.resolve()
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = async () => {
      const snapshot = structuredClone(db)
      try {
        return await fn(TX)
      } catch (err) {
        Object.assign(db, snapshot) // ROLLBACK
        throw err
      }
    }
    const result = chain.then(run, run)
    chain = result.catch(() => undefined)
    return result
  },
}))

vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: {
    findById: async (t: string, b: string, id: string) => {
      const row = scoped(db.conversations, t, b).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    findByIdForUpdate: async (t: string, b: string, id: string) => {
      const row = scoped(db.conversations, t, b).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    updateById: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      if (fail.conversationUpdate) {
        fail.conversationUpdate = false
        throw new Error('conversation update failed')
      }
      const row = scoped(db.conversations, t, b).find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
  },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.requests, t, b).find((r) => r.id === id) ?? null,
    createWithInitialHistory: async (data: Row, changedByUserId: string | null) => {
      await new Promise((resolve) => setTimeout(resolve, 1)) // let unserialized callers interleave
      if (fail.requestInsert) {
        fail.requestInsert = false
        throw new Error('request insert failed')
      }
      const row = { ...data, id: newId('req') }
      db.requests.push(row)
      db.histories.push({ id: newId('hist'), tenantId: data.tenantId, businessId: data.businessId, customerRequestId: row.id, toStatus: data.status, changedByUserId } as Row)
      return row
    },
  },
}))
vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({
  serviceFollowUpRepository: { markBookedByCustomerRequest: async () => 0 },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: async (t: string, b: string, id: string) => scoped(db.customers, t, b).find((r) => r.id === id) ?? null },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: { findById: async (t: string, b: string, id: string) => scoped(db.vehicles, t, b).find((r) => r.id === id) ?? null },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: { findById: async (t: string, b: string, id: string) => scoped(db.services, t, b).find((r) => r.id === id) ?? null },
}))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { findById: async () => null },
}))

import { createCustomerRequestFromConversation, requestSourceForChannel } from '../src/server/services/conversationRequestService'
import { createRequestFromConversationSchema } from '../src/server/validation/conversationRequest.schemas'
import { ApiError } from '../src/server/lib/errors'

TX.customerRequest = {
  findFirst: async ({ where }: { where: { tenantId: string; businessId: string; id: string } }) =>
    scoped(db.requests, where.tenantId, where.businessId).find((r) => r.id === where.id) ?? null,
}

const ctx = makeAuthContext('manager') // t1 / b1
const foreignCtx = makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const OTHER_CUSTOMER = '12111111-1111-4111-8111-111111111111'
const VEHICLE = '22222222-2222-4222-8222-222222222222'
const OTHER_VEHICLE = '23222222-2222-4222-8222-222222222222'
const FOREIGN_VEHICLE = '24222222-2222-4222-8222-222222222222'
const SERVICE = '33333333-3333-4333-8333-333333333333'
const INACTIVE_SERVICE = '34333333-3333-4333-8333-333333333333'
const FOREIGN_SERVICE = '35333333-3333-4333-8333-333333333333'
const FOREIGN_CUSTOMER = '13111111-1111-4111-8111-111111111111'

function seed() {
  for (const key of Object.keys(db) as Array<keyof typeof db>) db[key] = []
  Object.assign(fail, { conversationUpdate: false, requestInsert: false })
  const own = { tenantId: 't1', businessId: 'b1' }
  const foreign = { tenantId: 't2', businessId: 'b2' }
  db.customers.push({ ...own, id: CUSTOMER, isActive: true }, { ...own, id: OTHER_CUSTOMER, isActive: true }, { ...foreign, id: FOREIGN_CUSTOMER, isActive: true })
  db.vehicles.push(
    { ...own, id: VEHICLE, customerId: CUSTOMER, isActive: true },
    { ...own, id: OTHER_VEHICLE, customerId: OTHER_CUSTOMER, isActive: true },
    { ...foreign, id: FOREIGN_VEHICLE, customerId: FOREIGN_CUSTOMER, isActive: true }
  )
  db.services.push(
    { ...own, id: SERVICE, isActive: true },
    { ...own, id: INACTIVE_SERVICE, isActive: false },
    { ...foreign, id: FOREIGN_SERVICE, isActive: true }
  )
}

function addConversation(overrides: Record<string, unknown> = {}): Row {
  const row: Row = { id: newId('conv'), tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, customerRequestId: null, channel: 'TELEGRAM', status: 'OPEN', subject: null, ...overrides }
  db.conversations.push(row)
  return row
}

const input = (overrides: Record<string, unknown> = {}) =>
  createRequestFromConversationSchema.parse({ subject: 'Стук в подвеске', description: 'Стучит справа спереди', ...overrides })

async function expectApiError(promise: Promise<unknown>, status: number, code?: string, message?: string) {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).statusCode).toBe(status)
  if (code) expect((err as ApiError).code).toBe(code)
  if (message) expect((err as ApiError).message).toBe(message)
}

beforeEach(() => {
  seq = 0
  seed()
})

describe('create a CustomerRequest from a conversation', () => {
  it('creates one request and links the conversation to it', async () => {
    const conv = addConversation()

    const result = await createCustomerRequestFromConversation(ctx, conv.id, input({ vehicleId: VEHICLE, serviceId: SERVICE }))

    expect(result.created).toBe(true)
    expect(db.requests).toHaveLength(1)
    expect(db.conversations[0]!.customerRequestId).toBe(result.request.id)
    expect(result.conversation.customerRequestId).toBe(result.request.id)
    expect(db.requests[0]).toMatchObject({ tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, vehicleId: VEHICLE, serviceId: SERVICE, subject: 'Стук в подвеске', description: 'Стучит справа спереди' })
  })

  it('starts in the existing initial status NEW with a history row — no appointment, no conversion', async () => {
    const conv = addConversation()

    const { request } = await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(request.status).toBe('NEW')
    expect(request.appointmentId).toBeNull()
    expect(db.histories).toEqual([expect.objectContaining({ customerRequestId: request.id, toStatus: 'NEW', changedByUserId: 'u1' })])
  })

  it('does not change the conversation status (it stays usable)', async () => {
    const conv = addConversation({ status: 'OPEN' })

    await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(db.conversations[0]!.status).toBe('OPEN')
  })

  it.each([
    ['PHONE', 'PHONE'],
    ['WEBSITE', 'WEBSITE'],
    ['MANUAL', 'MANUAL'],
    ['TELEGRAM', 'OTHER'],
    ['WHATSAPP', 'OTHER'],
    ['OTHER', 'OTHER'],
  ] as const)('source from the existing enum: %s conversation → %s', async (channel, source) => {
    expect(requestSourceForChannel(channel)).toBe(source)
    const conv = addConversation({ channel })
    const { request } = await createCustomerRequestFromConversation(ctx, conv.id, input())
    expect(request.source).toBe(source)
  })
})

describe('customer linkage', () => {
  it("reuses the conversation's customer — no duplicate customer, nothing to select", async () => {
    const conv = addConversation({ customerId: CUSTOMER })

    const { request } = await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(request.customerId).toBe(CUSTOMER)
    expect(db.customers).toHaveLength(3)
  })

  it("refuses a different customer than the conversation's own", async () => {
    const conv = addConversation({ customerId: CUSTOMER })

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ customerId: OTHER_CUSTOMER })), 400, 'VALIDATION_ERROR', 'У диалога уже есть клиент — выбрать другого нельзя')
    expect(db.requests).toHaveLength(0)
  })

  it('a conversation without a customer requires one: «Клиент не выбран»', async () => {
    const conv = addConversation({ customerId: null })

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input()), 400, 'CUSTOMER_REQUIRED', 'Клиент не выбран')
    expect(db.requests).toHaveLength(0)
  })

  it('a conversation without a customer takes the chosen customer and links it to the conversation too', async () => {
    const conv = addConversation({ customerId: null })

    const { request } = await createCustomerRequestFromConversation(ctx, conv.id, input({ customerId: OTHER_CUSTOMER }))

    expect(request.customerId).toBe(OTHER_CUSTOMER)
    expect(db.conversations[0]).toMatchObject({ customerId: OTHER_CUSTOMER, customerRequestId: request.id })
  })

  it('a foreign-tenant customer is rejected (not found), nothing written', async () => {
    const conv = addConversation({ customerId: null })

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ customerId: FOREIGN_CUSTOMER })), 404, 'NOT_FOUND', 'Клиент не найден')
    expect(db.requests).toHaveLength(0)
    expect(db.conversations[0]!.customerId).toBeNull()
  })

  it('an inactive customer is rejected in Russian', async () => {
    db.customers[0]!.isActive = false
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input()), 400, 'VALIDATION_ERROR', 'Клиент неактивен — обращение создать нельзя')
  })
})

describe('vehicle and service ownership', () => {
  it("a vehicle of another customer: «Автомобиль не принадлежит выбранному клиенту»", async () => {
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ vehicleId: OTHER_VEHICLE })), 400, 'VALIDATION_ERROR', 'Автомобиль не принадлежит выбранному клиенту')
    expect(db.requests).toHaveLength(0)
  })

  it('a foreign-tenant vehicle is rejected (not found)', async () => {
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ vehicleId: FOREIGN_VEHICLE })), 404, 'NOT_FOUND', 'Автомобиль не найден')
  })

  it('vehicle stays optional (existing request semantics)', async () => {
    const conv = addConversation()

    const { request } = await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(request.vehicleId).toBeNull()
  })

  it('a foreign-tenant service is rejected (not found)', async () => {
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ serviceId: FOREIGN_SERVICE })), 404, 'NOT_FOUND', 'Услуга не найдена')
  })

  it('an inactive service is rejected in Russian', async () => {
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ serviceId: INACTIVE_SERVICE })), 400, 'VALIDATION_ERROR', 'Услуга неактивна — выберите другую')
  })
})

describe('idempotency and concurrency — one conversation, one primary request', () => {
  it('a repeated call returns the same request (created: false) and creates nothing', async () => {
    const conv = addConversation()

    const first = await createCustomerRequestFromConversation(ctx, conv.id, input())
    const second = await createCustomerRequestFromConversation(ctx, conv.id, input({ subject: 'Другая тема' }))

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.request.id).toBe(first.request.id)
    expect(db.requests).toHaveLength(1)
  })

  it('10 concurrent calls → exactly one request, all responses point to it, no orphans', async () => {
    const conv = addConversation()

    const results = await Promise.all(Array.from({ length: 10 }, () => createCustomerRequestFromConversation(ctx, conv.id, input())))

    expect(db.requests).toHaveLength(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => r.request.id))).toEqual(new Set([db.requests[0]!.id]))
    expect(db.conversations[0]!.customerRequestId).toBe(db.requests[0]!.id)
    expect(db.requests.every((r) => db.conversations.some((c) => c.customerRequestId === r.id))).toBe(true)
  })

  it('a conversation already linked to a terminal (CONVERTED) request returns it — never a second one', async () => {
    const conv = addConversation()
    db.requests.push({ id: 'req-done', tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, status: 'CONVERTED' })
    conv.customerRequestId = 'req-done'

    const result = await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(result.created).toBe(false)
    expect(result.request.id).toBe('req-done')
    expect(db.requests).toHaveLength(1)
  })

  it('a conversation linked manually earlier (existing feature) is returned as-is', async () => {
    db.requests.push({ id: 'req-manual', tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, status: 'IN_PROGRESS' })
    const conv = addConversation({ customerRequestId: 'req-manual' })

    const result = await createCustomerRequestFromConversation(ctx, conv.id, input())

    expect(result).toMatchObject({ created: false, request: { id: 'req-manual' } })
  })

  it('the conversation got a customer between validation and the lock → 409, nothing inserted', async () => {
    const conv = addConversation({ customerId: null })
    const { conversationRepository } = await import('../src/server/repositories/conversationRepository')
    const original = conversationRepository.findByIdForUpdate
    conversationRepository.findByIdForUpdate = async (t: string, b: string, id: string, tx: never) => {
      const row = await original(t, b, id, tx)
      return row ? { ...row, customerId: CUSTOMER } : null
    }
    try {
      await expectApiError(createCustomerRequestFromConversation(ctx, conv.id, input({ customerId: OTHER_CUSTOMER })), 409, 'CONFLICT')
      expect(db.requests).toHaveLength(0)
    } finally {
      conversationRepository.findByIdForUpdate = original
    }
  })
})

describe('transactional integrity', () => {
  it('linking the conversation fails → the inserted request is rolled back (no request without its link)', async () => {
    const conv = addConversation()
    fail.conversationUpdate = true

    await expect(createCustomerRequestFromConversation(ctx, conv.id, input())).rejects.toThrow('conversation update failed')
    expect(db.requests).toHaveLength(0)
    expect(db.histories).toHaveLength(0)
    expect(db.conversations[0]!.customerRequestId).toBeNull()

    const retry = await createCustomerRequestFromConversation(ctx, conv.id, input())
    expect(retry.created).toBe(true)
    expect(db.requests).toHaveLength(1)
  })

  it('the request insert fails → the conversation is not linked (no link to a missing request)', async () => {
    const conv = addConversation({ customerId: null })
    fail.requestInsert = true

    await expect(createCustomerRequestFromConversation(ctx, conv.id, input({ customerId: CUSTOMER }))).rejects.toThrow('request insert failed')
    expect(db.conversations[0]).toMatchObject({ customerRequestId: null, customerId: null })
  })
})

describe('tenant isolation', () => {
  it("another tenant's conversation → 404 «Диалог не найден», nothing created or linked", async () => {
    const conv = addConversation()

    await expectApiError(createCustomerRequestFromConversation(foreignCtx, conv.id, input()), 404, 'NOT_FOUND', 'Диалог не найден')
    expect(db.requests).toHaveLength(0)
    expect(db.conversations[0]!.customerRequestId).toBeNull()
  })

  it("another tenant cannot read this tenant's linked request through the bridge", async () => {
    db.requests.push({ id: 'req-own', tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, status: 'NEW' })
    const conv = addConversation({ customerRequestId: 'req-own' })

    await expectApiError(createCustomerRequestFromConversation(foreignCtx, conv.id, input()), 404, 'NOT_FOUND')
  })
})

describe('input validation (Russian, user-facing)', () => {
  it('requires a subject of at least 2 characters', () => {
    const tooShort = createRequestFromConversationSchema.safeParse({ subject: 'A' })
    expect(tooShort.success).toBe(false)
    expect(tooShort.error!.issues[0]!.message).toBe('Тема обращения слишком короткая')
    expect(createRequestFromConversationSchema.safeParse({}).error!.issues[0]!.message).toBe('Укажите тему обращения')
  })

  it('treats empty selects as "not chosen" and rejects malformed ids', () => {
    expect(createRequestFromConversationSchema.parse({ subject: 'Тема', vehicleId: '', serviceId: '', customerId: '' })).toMatchObject({ vehicleId: null, serviceId: null, customerId: null })
    expect(createRequestFromConversationSchema.safeParse({ subject: 'Тема', vehicleId: 'abc' }).error!.issues[0]!.message).toBe('Некорректный автомобиль')
  })

  it('strips fields the operator cannot set (status, source, appointment, tenant)', () => {
    const parsed = createRequestFromConversationSchema.parse({ subject: 'Тема', status: 'CONVERTED', source: 'PHONE', appointmentId: 'x', tenantId: 't2' })
    expect(parsed).toEqual({ subject: 'Тема' })
  })
})
