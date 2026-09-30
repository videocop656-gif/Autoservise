import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 49.1 — the Conversation → CustomerRequest link is writable only
// through the "Создать обращение" bridge. Drives the real HTTP handlers
// (PATCH /api/conversations/:id and POST /api/conversations/:id/request) with
// the real schemas and services on a small in-memory store; only auth and the
// repositories are replaced. Every conversation write is recorded so a
// rejected PATCH is proven to have written nothing.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string; tenantId: string; businessId: string }

const { db, writes, auth } = vi.hoisted(() => ({
  db: { conversations: [] as Row[], requests: [] as Row[], customers: [] as Row[] },
  writes: [] as Array<{ via: string; id: string; data: Record<string, unknown> }>,
  auth: { ctx: null as unknown as AuthContext },
}))

const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)
let seq = 0

vi.mock('../src/server/middleware/requireAuth', () => ({ requireAuth: async () => auth.ctx }))
vi.mock('../src/server/db/transaction', () => ({ runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) }))
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
      writes.push({ via: 'updateById', id, data })
      const row = scoped(db.conversations, t, b).find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
    linkCustomerRequest: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      writes.push({ via: 'linkCustomerRequest', id, data })
      const row = scoped(db.conversations, t, b).find((r) => r.id === id && r.customerRequestId === null)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
  },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.requests, t, b).find((r) => r.id === id) ?? null,
    createWithInitialHistory: async (data: Row) => {
      const row = { ...data, id: `99999999-9999-4999-8999-${String(++seq).padStart(12, '0')}`, createdAt: new Date(), updatedAt: new Date() }
      db.requests.push(row)
      return row
    },
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: async (t: string, b: string, id: string) => scoped(db.customers, t, b).find((r) => r.id === id) ?? null },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({ vehicleRepository: { findById: async () => null } }))
vi.mock('../src/server/repositories/serviceRepository', () => ({ serviceRepository: { findById: async () => null } }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: { findById: async () => null } }))
vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({
  serviceFollowUpRepository: { markBookedByCustomerRequest: async () => 0 },
}))

import patchHandler from '../api/conversations/[id]'
import bridgeHandler from '../api/conversations/[id]/request'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const ownCtx = makeAuthContext('manager') // t1 / b1
const foreignCtx = makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const UNLINKED = '21111111-1111-4111-8111-111111111111'
const LINKED = '22111111-1111-4111-8111-111111111111'
const LINKED_REQUEST = '31111111-1111-4111-8111-111111111111'
const OTHER_REQUEST = '32111111-1111-4111-8111-111111111111'
const FOREIGN_REQUEST = '33111111-1111-4111-8111-111111111111'
const PROTECTED_MESSAGE = 'Связь диалога с обращением нельзя изменить или удалить'

function makeRes() {
  const res = { statusCode: 0, body: undefined as unknown } as { statusCode: number; body: any } & ApiResponse
  res.status = vi.fn((code: number) => {
    res.statusCode = code
    return res
  }) as never
  res.json = vi.fn((data: unknown) => {
    res.body = data
  }) as never
  return res
}

async function call(handler: typeof patchHandler, method: string, id: string, body: unknown) {
  const res = makeRes()
  await handler({ method, headers: {}, query: { id }, body } as unknown as ApiRequest, res)
  return res
}

const patch = (id: string, body: unknown) => call(patchHandler, 'PATCH', id, body)
const bridge = (id: string, body: unknown = { subject: 'Стук в подвеске' }) => call(bridgeHandler, 'POST', id, body)

function conversation(id: string, overrides: Record<string, unknown> = {}): Row {
  return {
    id,
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER,
    customerRequestId: null,
    channel: 'TELEGRAM',
    status: 'OPEN',
    subject: null,
    startedAt: new Date('2026-09-29T09:00:00Z'),
    lastMessageAt: null,
    closedAt: null,
    channelConnectionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const request = (id: string, t = 't1', b = 'b1'): Row => ({ id, tenantId: t, businessId: b, customerId: CUSTOMER, status: 'NEW', subject: 'Тема' })
const snapshot = () => structuredClone(db.conversations)

beforeEach(() => {
  seq = 0
  writes.length = 0
  auth.ctx = ownCtx
  db.customers = [{ id: CUSTOMER, tenantId: 't1', businessId: 'b1', isActive: true }]
  db.requests = [request(LINKED_REQUEST), request(OTHER_REQUEST), request(FOREIGN_REQUEST, 't2', 'b2')]
  db.conversations = [conversation(UNLINKED), conversation(LINKED, { customerRequestId: LINKED_REQUEST })]
})

function expectProtectedRejection(res: { statusCode: number; body: any }) {
  expect(res.statusCode).toBe(400)
  expect(res.body.error.code).toBe('VALIDATION_ERROR')
  expect(res.body.error.details.customerRequestId).toEqual([PROTECTED_MESSAGE])
}

describe('generic PATCH /api/conversations/:id cannot touch the request link', () => {
  it('cannot attach a request to an unlinked conversation — nothing written', async () => {
    const before = snapshot()
    const res = await patch(UNLINKED, { customerRequestId: OTHER_REQUEST })

    expectProtectedRejection(res)
    expect(db.conversations).toEqual(before)
    expect(writes).toEqual([])
  })

  it('cannot replace an existing link with another request — nothing written', async () => {
    const before = snapshot()
    const res = await patch(LINKED, { customerRequestId: OTHER_REQUEST })

    expectProtectedRejection(res)
    expect(db.conversations).toEqual(before)
    expect(db.conversations[1]!.customerRequestId).toBe(LINKED_REQUEST)
    expect(writes).toEqual([])
  })

  it.each([
    ['null', null],
    ['an empty string', ''],
  ])('cannot clear an existing link with %s — nothing written', async (_label, value) => {
    const before = snapshot()
    const res = await patch(LINKED, { customerRequestId: value })

    expectProtectedRejection(res)
    expect(db.conversations).toEqual(before)
    expect(writes).toEqual([])
  })

  it('a mixed payload is rejected as a whole — the allowed field is not half-applied', async () => {
    const before = snapshot()
    const res = await patch(LINKED, { status: 'CLOSED', subject: 'Новая тема', customerRequestId: null })

    expectProtectedRejection(res)
    expect(db.conversations).toEqual(before)
    expect(db.conversations[1]).toMatchObject({ status: 'OPEN', subject: null, customerRequestId: LINKED_REQUEST })
    expect(writes).toEqual([])
  })
})

describe('ordinary PATCH keeps working', () => {
  it('closing and reopening a linked conversation keeps the link', async () => {
    const closed = await patch(LINKED, { status: 'CLOSED' })
    expect(closed.statusCode).toBe(200)
    expect(closed.body.conversation).toMatchObject({ status: 'CLOSED', customerRequestId: LINKED_REQUEST })
    expect(closed.body.conversation.closedAt).toBeInstanceOf(Date)

    const reopened = await patch(LINKED, { status: 'OPEN' })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.body.conversation).toMatchObject({ status: 'OPEN', closedAt: null, customerRequestId: LINKED_REQUEST })
    expect(writes.every((w) => !('customerRequestId' in w.data))).toBe(true)
  })

  it('a subject edit works and leaves the link alone', async () => {
    const res = await patch(LINKED, { subject: 'Уточнение по записи' })

    expect(res.statusCode).toBe(200)
    expect(db.conversations[1]).toMatchObject({ subject: 'Уточнение по записи', customerRequestId: LINKED_REQUEST })
  })
})

describe('the Prompt 49 bridge is the only way to link', () => {
  it('after a rejected PATCH attach, the bridge still creates and links exactly one request', async () => {
    await patch(UNLINKED, { customerRequestId: OTHER_REQUEST })

    const created = await bridge(UNLINKED)
    expect(created.statusCode).toBe(201)
    expect(created.body.created).toBe(true)
    const newId = created.body.customerRequest.id as string
    expect(newId).not.toBe(OTHER_REQUEST)
    expect(db.conversations[0]!.customerRequestId).toBe(newId)
    expect(writes).toEqual([{ via: 'linkCustomerRequest', id: UNLINKED, data: { customerRequestId: newId } }])

    const repeated = await bridge(UNLINKED, { subject: 'Другая тема' })
    expect(repeated.statusCode).toBe(200)
    expect(repeated.body).toMatchObject({ created: false, customerRequest: { id: newId } })
    expect(db.requests).toHaveLength(4)
  })

  it('on an already linked conversation the bridge returns the existing request and writes nothing', async () => {
    const res = await bridge(LINKED)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ created: false, customerRequest: { id: LINKED_REQUEST } })
    expect(writes).toEqual([])
  })
})

describe('tenant isolation', () => {
  it('a foreign request id is refused exactly like an own one — no existence probe', async () => {
    const own = await patch(UNLINKED, { customerRequestId: OTHER_REQUEST })
    const foreign = await patch(UNLINKED, { customerRequestId: FOREIGN_REQUEST })
    const missing = await patch(UNLINKED, { customerRequestId: '34111111-1111-4111-8111-111111111111' })

    expect(foreign.statusCode).toBe(own.statusCode)
    expect(foreign.body).toEqual(own.body)
    expect(missing.body).toEqual(own.body)
    expect(writes).toEqual([])
  })

  it("another tenant cannot relink or unlink this tenant's conversation, and gets 404 for ordinary fields", async () => {
    auth.ctx = foreignCtx
    const before = snapshot()

    expectProtectedRejection(await patch(LINKED, { customerRequestId: FOREIGN_REQUEST }))
    expectProtectedRejection(await patch(LINKED, { customerRequestId: null }))
    const statusAttempt = await patch(LINKED, { status: 'CLOSED' })
    expect(statusAttempt.statusCode).toBe(404)

    expect(db.conversations).toEqual(before)
  })

  it("another tenant's bridge call on this tenant's conversation → 404, nothing linked", async () => {
    auth.ctx = foreignCtx
    const res = await bridge(UNLINKED)

    expect(res.statusCode).toBe(404)
    expect(db.conversations[0]!.customerRequestId).toBeNull()
    expect(writes).toEqual([])
  })
})
