import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness, makeTenant } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 54 — Customer & Vehicle intake from a conversation.
// Real handlers (POST /api/conversations/:id/customer, …/vehicles), real
// conversationIntakeService, customerService (prepareCustomerCreate),
// vehicleService (createVehicle) and the real phone normalization, on a small
// in-memory store. runInTransaction snapshots and RESTORES the store when the
// callback throws, and runs one at a time — so a lost race really rolls the
// created customer back.
// ---------------------------------------------------------------------------

type Row = Record<string, any> & { id: string; tenantId: string; businessId: string }

const { db, auth } = vi.hoisted(() => ({
  db: { conversations: [] as Row[], customers: [] as Row[], vehicles: [] as Row[], requests: [] as Row[] },
  auth: { ctx: null as AuthContext | null },
}))
let seq = 0
const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++seq).padStart(12, '0')}`
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)

let chain: Promise<unknown> = Promise.resolve()
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = async () => {
      const snapshot = structuredClone(db)
      try {
        return await fn({ __tx: true })
      } catch (err) {
        Object.assign(db, snapshot)
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
    setCustomerIfUnchanged: async (t: string, b: string, id: string, expected: string | null, customerId: string) => {
      await new Promise((r) => setTimeout(r, 1)) // let unserialized callers interleave
      const row = scoped(db.conversations, t, b).find((r) => r.id === id && r.customerId === expected)
      if (!row) return null
      row.customerId = customerId
      return { ...row }
    },
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.customers, t, b).find((r) => r.id === id) ?? null,
    findActiveByEmail: async (t: string, b: string, email: string) => scoped(db.customers, t, b).find((r) => r.isActive && r.email === email) ?? null,
    // MCR-1 — the canonical-phone lookup; seeded rows get phoneE164 the way the migration backfill would.
    findActiveByPhoneE164: async (t: string, b: string, e164: string) => {
      const { normalizePhone } = await import('../src/server/lib/phone')
      return scoped(db.customers, t, b)
        .filter((r) => r.isActive && (r.phoneE164 ?? normalizePhone(r.phone, 'KZ')) === e164)
        .map((r) => ({ id: r.id }))
    },
    create: async (data: Row) => {
      const row = { ...data, id: uuid('cccccccc-cccc'), isActive: true, createdAt: new Date(), updatedAt: new Date() }
      db.customers.push(row)
      return row
    },
  },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: { findById: async (t: string, b: string, id: string) => scoped(db.requests, t, b).find((r) => r.id === id) ?? null },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: {
    list: async (t: string, b: string, o: { activeOnly: boolean; customerId?: string }) => {
      const items = scoped(db.vehicles, t, b).filter((v) => (!o.activeOnly || v.isActive) && (!o.customerId || v.customerId === o.customerId))
      return { items, total: items.length }
    },
    findById: async (t: string, b: string, id: string) => scoped(db.vehicles, t, b).find((r) => r.id === id) ?? null,
    create: async (data: Row) => {
      const row = { ...data, id: uuid('dddddddd-dddd'), isActive: true, createdAt: new Date(), updatedAt: new Date() }
      db.vehicles.push(row)
      return row
    },
  },
}))
vi.mock('../src/server/middleware/requireAuth', () => ({
  requireAuth: async () => {
    if (auth.ctx) return auth.ctx
    const { ApiError } = await import('../src/server/lib/errors')
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  },
}))

import customerHandler from '../api/conversations/[id]/customer'
import vehiclesHandler from '../api/conversations/[id]/vehicles'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const owner = makeAuthContext('owner') // t1 / b1
const manager = makeAuthContext('manager')
const foreign = makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })

const CONV = '11111111-1111-4111-8111-111111111111'
const CONV_WITH_REQUEST = '12111111-1111-4111-8111-111111111111'
const ALICE = '21111111-1111-4111-8111-111111111111'
const BORIS = '22111111-1111-4111-8111-111111111111'
const FOREIGN_CUSTOMER = '23111111-1111-4111-8111-111111111111'
const INACTIVE = '24111111-1111-4111-8111-111111111111'
const REQUEST = '31111111-1111-4111-8111-111111111111'

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
async function post(handler: typeof customerHandler, id: string, body: unknown) {
  const res = makeRes()
  await handler({ method: 'POST', headers: {}, query: { id }, body } as unknown as ApiRequest, res)
  return res
}
const customerAction = (body: unknown, id = CONV) => post(customerHandler, id, body)
const addVehicle = (body: unknown, id = CONV) => post(vehiclesHandler, id, body)
const conv = (id = CONV) => db.conversations.find((c) => c.id === id)!
const newCustomer = (overrides: Record<string, unknown> = {}) => ({ action: 'create', customer: { firstName: 'Алексей', lastName: 'Смирнов', phone: '+7 (901) 555-44-33', ...overrides } })

beforeEach(() => {
  seq = 0
  auth.ctx = owner
  const own = { tenantId: 't1', businessId: 'b1' }
  db.customers = [
    { ...own, id: ALICE, firstName: 'Алиса', lastName: null, phone: '8 900 111-22-33', email: 'alice@example.com', isActive: true },
    { ...own, id: BORIS, firstName: 'Борис', lastName: 'Б.', phone: '+79002223344', email: null, isActive: true },
    { ...own, id: INACTIVE, firstName: 'Старый', lastName: null, phone: '+79003334455', email: null, isActive: false },
    { tenantId: 't2', businessId: 'b2', id: FOREIGN_CUSTOMER, firstName: 'Чужой', lastName: null, phone: '+79001112233', email: null, isActive: true },
  ]
  db.conversations = [
    { ...own, id: CONV, customerId: null, customerRequestId: null, status: 'OPEN', channel: 'TELEGRAM' },
    { ...own, id: CONV_WITH_REQUEST, customerId: ALICE, customerRequestId: REQUEST, status: 'OPEN', channel: 'TELEGRAM' },
  ]
  db.requests = [{ ...own, id: REQUEST, customerId: ALICE, vehicleId: null }]
  db.vehicles = [
    { ...own, id: 'v-alice', customerId: ALICE, make: 'Kia', model: 'Rio', year: 2019, licensePlate: 'A123BC77', vin: 'VINALICE000000001', isActive: true },
    { ...own, id: 'v-boris', customerId: BORIS, make: 'Lada', model: 'Vesta', year: 2020, licensePlate: 'B456CD77', vin: 'VINBORIS000000001', isActive: true },
    { tenantId: 't2', businessId: 'b2', id: 'v-foreign', customerId: FOREIGN_CUSTOMER, make: 'BMW', model: 'X5', year: 2022, licensePlate: 'C789EF77', vin: 'VINFOREIGN0000001', isActive: true },
  ]
})

describe('create a customer from a conversation', () => {
  it('creates the customer (existing rules) and links it to the conversation in one step', async () => {
    const res = await customerAction(newCustomer())

    expect(res.statusCode).toBe(201)
    expect(res.body.customer).toMatchObject({ firstName: 'Алексей', lastName: 'Смирнов', phone: '+7 (901) 555-44-33' })
    expect(conv().customerId).toBe(res.body.customer.id)
    expect(res.body.conversation.customerId).toBe(res.body.customer.id)
    expect(db.customers.filter((c) => c.tenantId === 't1')).toHaveLength(4)
  })

  it('touches nothing else: no request link, no request, no vehicle', async () => {
    await customerAction(newCustomer())
    expect(conv().customerRequestId).toBeNull()
    expect(db.requests).toHaveLength(1)
    expect(db.vehicles).toHaveLength(3)
  })

  it('same phone (normalized, any formatting) in THIS business → 409 with the existing customer, nothing created', async () => {
    const res = await customerAction(newCustomer({ phone: '+7 (900) 111-22-33' }))

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'CUSTOMER_PHONE_EXISTS', message: 'Клиент с таким номером уже существует.' })
    expect(res.body.error.details.matches).toEqual([{ id: ALICE, firstName: 'Алиса', lastName: null, phone: '8 900 111-22-33' }])
    expect(db.customers.filter((c) => c.tenantId === 't1')).toHaveLength(3)
    expect(conv().customerId).toBeNull()
  })

  it.each(['9001112233', '8 (900) 111 22 33', '+79001112233'])(
    'MCR-1: %j is the same canonical number as Alice’s "8 900 111-22-33" → the same duplicate',
    async (phone) => {
      const res = await customerAction(newCustomer({ phone }))
      expect(res.statusCode).toBe(409)
      expect(res.body.error.details.matches.map((m: { id: string }) => m.id)).toEqual([ALICE])
    }
  )

  it('MCR-1: a different number that shares only the last digits is not a duplicate (no last-10-digits heuristic)', async () => {
    // A valid German number ending in Alice's 10 digits: the old tail heuristic called it a duplicate.
    expect((await customerAction(newCustomer({ phone: '+49 900 1112233' }))).statusCode).toBe(201)
  })

  it("another tenant's customer with the same phone is never revealed or matched", async () => {
    // FOREIGN_CUSTOMER (t2) has +79001112233 = Alice's number; only Alice (t1) may come back.
    const res = await customerAction(newCustomer({ phone: '89001112233' }))
    expect(res.body.error.details.matches.map((m: { id: string }) => m.id)).toEqual([ALICE])
    expect(JSON.stringify(res.body)).not.toContain('Чужой')
  })

  it('an inactive same-phone customer is not a duplicate', async () => {
    expect((await customerAction(newCustomer({ phone: '+7 900 333-44-55' }))).statusCode).toBe(201)
  })

  it('the existing active-email rule still applies (409 CUSTOMER_EMAIL_EXISTS)', async () => {
    const res = await customerAction(newCustomer({ email: 'alice@example.com' }))
    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CUSTOMER_EMAIL_EXISTS')
  })

  it('a conversation that already has a customer is never given a second one by "create"', async () => {
    const res = await customerAction(newCustomer(), CONV_WITH_REQUEST)
    expect(res.statusCode).toBe(409)
    expect(res.body.error.code).toBe('CONVERSATION_HAS_CUSTOMER')
    expect(conv(CONV_WITH_REQUEST).customerId).toBe(ALICE)
  })

  it('two simultaneous creates (two tabs): exactly one links; the loser is rolled back — no orphan customer', async () => {
    const [a, b] = await Promise.all([customerAction(newCustomer()), customerAction(newCustomer({ firstName: 'Другой', phone: '+7 911 000-00-01' }))])

    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409])
    const loser = a.statusCode === 409 ? a : b
    expect(['CONVERSATION_CHANGED', 'CONVERSATION_HAS_CUSTOMER']).toContain(loser.body.error.code)
    expect(db.customers.filter((c) => c.tenantId === 't1')).toHaveLength(4) // 3 seeded + exactly 1 new
    expect(db.customers.some((c) => c.id === conv().customerId)).toBe(true)
  })

  it('manager may not create customers (existing policy: owner/admin) → 403, nothing written', async () => {
    auth.ctx = manager
    const res = await customerAction(newCustomer())
    expect(res.statusCode).toBe(403)
    expect(db.customers.filter((c) => c.tenantId === 't1')).toHaveLength(3)
  })
})

describe('link an existing customer', () => {
  it('links a same-business customer; manager may link', async () => {
    auth.ctx = manager
    const res = await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: null })

    expect(res.statusCode).toBe(200)
    expect(conv().customerId).toBe(BORIS)
  })

  it('linking the customer that is already linked is a no-op success', async () => {
    const res = await customerAction({ action: 'link', customerId: ALICE, expectedCustomerId: ALICE }, CONV_WITH_REQUEST)
    expect(res.statusCode).toBe(200)
    expect(conv(CONV_WITH_REQUEST).customerId).toBe(ALICE)
  })

  it('an existing customer is never replaced silently: a stale expectation → 409, unchanged', async () => {
    db.conversations[0]!.customerId = ALICE
    const res = await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: null })

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'CONVERSATION_CHANGED', message: 'Данные изменились. Обновите диалог и попробуйте ещё раз.' })
    expect(conv().customerId).toBe(ALICE)
  })

  it('an explicit change (expecting the current customer) relinks — without a request it is allowed', async () => {
    db.conversations[0]!.customerId = ALICE
    const res = await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: ALICE })
    expect(res.statusCode).toBe(200)
    expect(conv().customerId).toBe(BORIS)
  })

  it('two operators linking different customers at once: one wins, the other gets 409 — never a silent overwrite', async () => {
    const [a, b] = await Promise.all([
      customerAction({ action: 'link', customerId: ALICE, expectedCustomerId: null }),
      customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: null }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    const winner = a.statusCode === 200 ? ALICE : BORIS
    expect(conv().customerId).toBe(winner)
  })

  it("another tenant's customer → 404, conversation unchanged", async () => {
    const res = await customerAction({ action: 'link', customerId: FOREIGN_CUSTOMER, expectedCustomerId: null })
    expect(res.statusCode).toBe(404)
    expect(conv().customerId).toBeNull()
  })

  it('an inactive customer is refused', async () => {
    const res = await customerAction({ action: 'link', customerId: INACTIVE, expectedCustomerId: null })
    expect(res.statusCode).toBe(400)
    expect(conv().customerId).toBeNull()
  })

  it("another tenant can't touch this tenant's conversation (404 for link, create and vehicle)", async () => {
    auth.ctx = foreign
    expect((await customerAction({ action: 'link', customerId: FOREIGN_CUSTOMER, expectedCustomerId: null })).statusCode).toBe(404)
    expect((await customerAction(newCustomer())).statusCode).toBe(404)
    expect((await addVehicle({ make: 'X', model: 'Y' }, CONV_WITH_REQUEST)).statusCode).toBe(404)
    expect(conv().customerId).toBeNull()
    expect(db.customers.filter((c) => c.tenantId === 't2')).toHaveLength(1)
  })

  it('unauthenticated → 401; malformed body → 400; wrong method → 405', async () => {
    auth.ctx = null
    expect((await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: null })).statusCode).toBe(401)
    auth.ctx = owner
    expect((await customerAction({ action: 'link', customerId: 'nope', expectedCustomerId: null })).statusCode).toBe(400)
    expect((await customerAction({ action: 'delete' })).statusCode).toBe(400)
    const res = makeRes()
    await customerHandler({ method: 'GET', headers: {}, query: { id: CONV }, body: undefined } as unknown as ApiRequest, res)
    expect(res.statusCode).toBe(405)
  })
})

describe('CustomerRequest consistency', () => {
  it("with a linked request, a different customer is refused (CUSTOMER_REQUEST_CONFLICT), nothing changes", async () => {
    const res = await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: ALICE }, CONV_WITH_REQUEST)

    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'CUSTOMER_REQUEST_CONFLICT', message: 'Нельзя изменить клиента: связанное обращение принадлежит другому клиенту.' })
    expect(conv(CONV_WITH_REQUEST)).toMatchObject({ customerId: ALICE, customerRequestId: REQUEST })
  })

  it('the request link itself can never be reached through intake (customerRequestId in the body is ignored)', async () => {
    const res = await customerAction({ action: 'link', customerId: BORIS, expectedCustomerId: null, customerRequestId: REQUEST })
    expect(res.statusCode).toBe(200)
    expect(conv().customerRequestId).toBeNull()
    expect(conv(CONV_WITH_REQUEST).customerRequestId).toBe(REQUEST)
  })
})

describe('add a vehicle for the linked customer', () => {
  it("is created for the conversation's customer — a customerId in the body is ignored", async () => {
    const res = await addVehicle({ make: 'Toyota', model: 'Camry', year: 2021, customerId: BORIS }, CONV_WITH_REQUEST)

    expect(res.statusCode).toBe(201)
    expect(res.body.vehicle).toMatchObject({ customerId: ALICE, make: 'Toyota', model: 'Camry', year: 2021 })
    expect(db.vehicles.filter((v) => v.customerId === BORIS)).toHaveLength(1)
  })

  it('requires a linked customer first', async () => {
    const res = await addVehicle({ make: 'Toyota', model: 'Camry' })
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'CONVERSATION_HAS_NO_CUSTOMER', message: 'Сначала свяжите диалог с клиентом.' })
  })

  it('same VIN or plate on the SAME customer → 409 VEHICLE_EXISTS with that vehicle, no duplicate', async () => {
    const byVin = await addVehicle({ make: 'Kia', model: 'Rio', vin: 'vinalice000000001' }, CONV_WITH_REQUEST)
    const byPlate = await addVehicle({ make: 'Kia', model: 'Rio', licensePlate: 'a123bc77' }, CONV_WITH_REQUEST)

    for (const res of [byVin, byPlate]) {
      expect(res.statusCode).toBe(409)
      expect(res.body.error.code).toBe('VEHICLE_EXISTS')
      expect(res.body.error.details.vehicle).toMatchObject({ id: 'v-alice', make: 'Kia', model: 'Rio' })
    }
    expect(db.vehicles.filter((v) => v.customerId === ALICE)).toHaveLength(1)
  })

  it("another customer's or another tenant's vehicle is never exposed, matched or moved", async () => {
    const sameAsBoris = await addVehicle({ make: 'Lada', model: 'Vesta', vin: 'VINBORIS000000001' }, CONV_WITH_REQUEST)
    const sameAsForeign = await addVehicle({ make: 'BMW', model: 'X5', licensePlate: 'C789EF77' }, CONV_WITH_REQUEST)

    expect(sameAsBoris.statusCode).toBe(201)
    expect(sameAsForeign.statusCode).toBe(201)
    expect(JSON.stringify([sameAsBoris.body, sameAsForeign.body])).not.toMatch(/v-boris|v-foreign/)
    expect(db.vehicles.find((v) => v.id === 'v-boris')!.customerId).toBe(BORIS)
    expect(db.vehicles.find((v) => v.id === 'v-foreign')!.customerId).toBe(FOREIGN_CUSTOMER)
  })

  it('manager may not add vehicles (existing policy) → 403', async () => {
    auth.ctx = manager
    expect((await addVehicle({ make: 'Toyota', model: 'Camry' }, CONV_WITH_REQUEST)).statusCode).toBe(403)
  })

  it('invalid vehicle data → 400 (existing vehicle schema)', async () => {
    expect((await addVehicle({ make: '', model: 'Camry' }, CONV_WITH_REQUEST)).statusCode).toBe(400)
    expect((await addVehicle({ make: 'Toyota', model: 'Camry', year: 1500 }, CONV_WITH_REQUEST)).statusCode).toBe(400)
  })
})
