import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

// ---------------------------------------------------------------------------
// MCR-2 — Missed Call Intake: routing by called number, one CallInteraction
// per call, provider-event idempotency, out-of-order safety, customer
// resolution (MCR-1), recovery eligibility, webhook security, and proof that
// nothing contacts anyone.
//
// The real callIntakeService, state machine, mock adapter and webhook handler
// run on a small in-memory store. runInTransaction models the row lock the
// real code takes (SELECT … FOR UPDATE): transactions run one at a time and a
// throwing one is rolled back. The real SQL (unique keys, FOR UPDATE) is
// pinned in tenantIsolation.test.ts and raced on Supabase (final-report-mcr-2).
// ---------------------------------------------------------------------------

type Row = Record<string, any>

const { db, outbound } = vi.hoisted(() => ({
  db: { numbers: [] as Row[], businesses: [] as Row[], customers: [] as Row[], calls: [] as Row[], events: [] as Row[] },
  outbound: { calls: [] as string[] },
}))

let seq = 0
const tick = () => new Promise((r) => setTimeout(r, 1))
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
vi.mock('../src/server/repositories/businessPhoneNumberRepository', () => ({
  isActiveNumberConflict: () => false,
  businessPhoneNumberRepository: {
    findActiveByPhoneE164ForRouting: async (e164: string) => db.numbers.find((n) => n.activePhoneE164 === e164) ?? null,
  },
}))
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { findFirstByTenant: async (t: string) => db.businesses.find((b) => b.tenantId === t) ?? null },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: {
    findActiveByPhoneE164: async (t: string, b: string, e164: string) =>
      db.customers.filter((c) => c.tenantId === t && c.businessId === b && c.isActive && c.phoneE164 === e164).map((c) => ({ id: c.id })),
    create: async () => {
      outbound.calls.push('customer.create')
      throw new Error('a call must never create a customer')
    },
  },
}))
vi.mock('../src/server/repositories/callInteractionRepository', () => ({
  callInteractionRepository: {
    insertIfAbsent: async (data: Row) => {
      await tick() // let concurrent callers interleave before the "lock"
      if (!db.calls.some((c) => c.provider === data.provider && c.providerCallId === data.providerCallId)) {
        db.calls.push({
          id: `call-${++seq}`,
          outcome: 'IN_PROGRESS',
          startedAt: null,
          answeredAt: null,
          endedAt: null,
          outcomeDetectedAt: null,
          recoveryIneligibleReason: null,
          ...data,
        })
      }
    },
    lockByProviderCall: async (p: string, id: string) => {
      const row = db.calls.find((c) => c.provider === p && c.providerCallId === id)
      return row ? { ...row } : null
    },
    insertEventIfAbsent: async (data: Row) => {
      if (db.events.some((e) => e.provider === data.provider && e.providerEventId === data.providerEventId)) return false
      db.events.push({ ...data })
      return true
    },
    update: async (id: string, data: Row) => {
      const row = db.calls.find((c) => c.id === id)!
      Object.assign(row, data)
      return { ...row }
    },
  },
}))
// Anything that could contact a customer or the owner — must never be touched.
const trap = (name: string) => new Proxy({}, { get: (_t, prop) => () => { outbound.calls.push(`${name}.${String(prop)}`); throw new Error(`${name} must not be used`) } })
vi.mock('../src/server/channels/channelAdapterRegistry', () => ({ getChannelAdapter: () => trap('channelAdapter') }))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({ channelDeliveryRepository: trap('channelDelivery') }))
vi.mock('../src/server/repositories/messageRepository', () => ({ messageRepository: trap('message') }))
vi.mock('../src/server/repositories/conversationRepository', () => ({ conversationRepository: trap('conversation') }))
vi.mock('../src/server/repositories/appointmentRepository', () => ({ appointmentRepository: trap('appointment') }))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({ customerRequestRepository: trap('customerRequest') }))
vi.mock('../src/server/services/aiService', () => trap('aiService'))

import { ingestCallEvent, CallIntakeError } from '../src/server/services/callIntakeService'
import { createMockTelephonyAdapter } from '../src/server/telephony/adapters/mockTelephonyAdapter'
import webhook from '../api/webhooks/telephony/mock'
import type { NormalizedCallEvent } from '../src/server/telephony/types'

const KZ_NUMBER = '+77272500000' // business A (t1)
const T2_NUMBER = '+77172500000' // business B (t2)
const KNOWN = '+77011234567' // customer of business A
const SECRET = 'test-mock-telephony-secret'

function event(overrides: Partial<NormalizedCallEvent> = {}): NormalizedCallEvent {
  return {
    provider: 'mock',
    providerEventId: `ev-${++seq}`,
    providerCallId: 'call-A',
    eventType: 'RINGING',
    direction: 'INBOUND',
    callerPhone: '8 701 123 45 67',
    calledPhone: KZ_NUMBER,
    occurredAt: null,
    wasAnswered: null,
    ...overrides,
  }
}
const call = (id = 'call-A') => db.calls.find((c) => c.providerCallId === id)
const at = (s: number) => new Date(Date.UTC(2026, 9, 3, 9, 0, s))

beforeEach(() => {
  seq = 0
  outbound.calls = []
  db.businesses = [
    { id: 'b1', tenantId: 't1', phoneRegion: 'KZ' },
    { id: 'b2', tenantId: 't2', phoneRegion: 'KZ' },
  ]
  db.numbers = [
    { id: 'n1', tenantId: 't1', businessId: 'b1', phoneE164: KZ_NUMBER, isActive: true, activePhoneE164: KZ_NUMBER },
    { id: 'n2', tenantId: 't2', businessId: 'b2', phoneE164: T2_NUMBER, isActive: true, activePhoneE164: T2_NUMBER },
    { id: 'n3', tenantId: 't1', businessId: 'b1', phoneE164: '+77272500001', isActive: false, activePhoneE164: null },
  ]
  db.customers = [
    { id: 'cust-1', tenantId: 't1', businessId: 'b1', isActive: true, phoneE164: KNOWN },
    { id: 'cust-t2', tenantId: 't2', businessId: 'b2', isActive: true, phoneE164: '+77019998877' },
    { id: 'amb-1', tenantId: 't1', businessId: 'b1', isActive: true, phoneE164: '+77015554433' },
    { id: 'amb-2', tenantId: 't1', businessId: 'b1', isActive: true, phoneE164: '+77015554433' },
  ]
  db.calls = []
  db.events = []
  process.env.TELEPHONY_MOCK_WEBHOOK_SECRET = SECRET
})
afterEach(() => {
  delete process.env.TELEPHONY_MOCK_WEBHOOK_SECRET
  expect(outbound.calls).toEqual([]) // G: nothing ever contacts anyone, in any test
})

// ---------------------------------------------------------------------------
describe('A. routing — the called number decides the tenant', () => {
  it('a valid active number routes to its business', async () => {
    await ingestCallEvent(event())
    expect(call()).toMatchObject({ tenantId: 't1', businessId: 'b1', businessPhoneNumberId: 'n1' })
  })

  it('unknown number → UNROUTABLE_NUMBER, nothing written', async () => {
    await expect(ingestCallEvent(event({ calledPhone: '+77272599999' }))).rejects.toMatchObject({ code: 'UNROUTABLE_NUMBER' })
    expect(db.calls).toEqual([])
    expect(db.events).toEqual([])
  })

  it('inactive number → UNROUTABLE_NUMBER', async () => {
    await expect(ingestCallEvent(event({ calledPhone: '+77272500001' }))).rejects.toBeInstanceOf(CallIntakeError)
    expect(db.calls).toEqual([])
  })

  it('a national-format called number is never guessed into a region → UNROUTABLE_NUMBER', async () => {
    await expect(ingestCallEvent(event({ calledPhone: '8 727 250 00 00' }))).rejects.toMatchObject({ code: 'UNROUTABLE_NUMBER' })
  })

  it("the caller's number never selects a tenant (caller = t2's business number, called = t1's)", async () => {
    await ingestCallEvent(event({ callerPhone: T2_NUMBER }))
    expect(call()).toMatchObject({ tenantId: 't1', businessId: 'b1' })
  })

  it('cross-tenant: each number lands only in its own tenant', async () => {
    await ingestCallEvent(event({ providerCallId: 'x1' }))
    await ingestCallEvent(event({ providerCallId: 'x2', calledPhone: T2_NUMBER }))
    expect(call('x1')!.tenantId).toBe('t1')
    expect(call('x2')!.tenantId).toBe('t2')
  })

  it('an existing call id cannot be moved to another business → CALL_ROUTING_CONFLICT, nothing changed', async () => {
    await ingestCallEvent(event())
    const before = structuredClone(db)
    await expect(ingestCallEvent(event({ eventType: 'MISSED', calledPhone: T2_NUMBER }))).rejects.toMatchObject({ code: 'CALL_ROUTING_CONFLICT' })
    expect(db).toEqual(before)
  })

  it('outbound calls route by the business-side (caller) number', async () => {
    await ingestCallEvent(event({ direction: 'OUTBOUND', callerPhone: KZ_NUMBER, calledPhone: KNOWN }))
    expect(call()).toMatchObject({ businessId: 'b1', remotePhoneE164: KNOWN, direction: 'OUTBOUND' })
  })
})

// ---------------------------------------------------------------------------
describe('C. one CallInteraction per call — lifecycle, out-of-order, duplicates', () => {
  async function run(...types: [NormalizedCallEvent['eventType'], (boolean | null)?][]) {
    for (const [eventType, wasAnswered = null] of types) await ingestCallEvent(event({ eventType, wasAnswered }))
    return call()!
  }

  it('A: ringing → missed  ⇒ MISSED, READY', async () => {
    const c = await run(['RINGING'], ['MISSED'])
    expect(c).toMatchObject({ outcome: 'MISSED', recoveryState: 'READY' })
    expect(db.calls).toHaveLength(1)
    expect(db.events).toHaveLength(2)
  })

  it('B: ringing → answered → completed  ⇒ ANSWERED, not eligible', async () => {
    const c = await run(['RINGING'], ['ANSWERED'], ['COMPLETED', true])
    expect(c).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'ANSWERED' })
  })

  it('C: missed → delayed ringing  ⇒ stays MISSED', async () => {
    const c = await run(['MISSED'], ['RINGING'])
    expect(c).toMatchObject({ outcome: 'MISSED', recoveryState: 'READY' })
  })

  it('D: completed(answered) → delayed answered  ⇒ stays ANSWERED', async () => {
    const c = await run(['COMPLETED', true], ['ANSWERED'])
    expect(c.outcome).toBe('ANSWERED')
  })

  it('answer evidence wins: answered → late missed / completed(false) / ringing never make it MISSED', async () => {
    const c = await run(['ANSWERED'], ['MISSED'], ['COMPLETED', false], ['RINGING'])
    expect(c).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
  })

  it('a late "answered" after "missed" corrects the call to ANSWERED (and takes it out of recovery)', async () => {
    const c = await run(['MISSED'], ['ANSWERED'])
    expect(c).toMatchObject({ outcome: 'ANSWERED', recoveryState: 'NOT_ELIGIBLE' })
  })

  it('completed without an answered flag claims nothing: stays IN_PROGRESS / PENDING', async () => {
    const c = await run(['RINGING'], ['COMPLETED', null])
    expect(c).toMatchObject({ outcome: 'IN_PROGRESS', recoveryState: 'PENDING' })
  })

  it('E: duplicate missed → duplicate missed  ⇒ one event effect, "duplicate" reported', async () => {
    const missed = event({ eventType: 'MISSED', providerEventId: 'ev-missed' })
    const first = await ingestCallEvent(missed, at(10))
    const second = await ingestCallEvent(missed, at(20))
    expect(first.status).toBe('accepted')
    expect(second).toMatchObject({ status: 'duplicate', outcome: 'MISSED' })
    expect(db.events).toHaveLength(1)
    expect(call()!.lastEventReceivedAt).toEqual(at(10)) // the redelivery changed nothing
  })

  it('F: concurrent deliveries — 5× the same event and 3 distinct events at once ⇒ one call, each event once', async () => {
    const same = event({ eventType: 'MISSED', providerEventId: 'ev-same' })
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => ingestCallEvent(same)),
      ingestCallEvent(event({ eventType: 'RINGING', providerEventId: 'ev-r' })),
      ingestCallEvent(event({ eventType: 'COMPLETED', wasAnswered: false, providerEventId: 'ev-c' })),
    ])
    expect(db.calls).toHaveLength(1)
    expect(db.events.map((e) => e.providerEventId).sort()).toEqual(['ev-c', 'ev-r', 'ev-same'])
    expect(results.filter((r) => r.status === 'duplicate')).toHaveLength(4)
    expect(call()!.outcome).toBe('MISSED')
  })

  it('same caller, different call ids ⇒ separate CallInteractions (three missed calls stay three)', async () => {
    for (const id of ['r1', 'r2', 'r3']) await ingestCallEvent(event({ providerCallId: id, eventType: 'MISSED' }))
    expect(db.calls).toHaveLength(3)
    expect(db.calls.every((c) => c.remotePhoneE164 === KNOWN && c.recoveryState === 'READY')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('timestamps — provider times vs AUTOSERVISE receipt times', () => {
  it('provider times are kept as given; receipt times are separate; detection = first final-outcome receipt', async () => {
    await ingestCallEvent(event({ eventType: 'RINGING', occurredAt: at(0) }), at(2))
    await ingestCallEvent(event({ eventType: 'MISSED', occurredAt: at(30) }), at(33))
    await ingestCallEvent(event({ eventType: 'RINGING', occurredAt: at(0) }), at(40)) // late redelivery-like
    expect(call()).toMatchObject({
      startedAt: at(0),
      endedAt: at(30),
      answeredAt: null,
      firstEventReceivedAt: at(2),
      lastEventReceivedAt: at(40),
      outcomeDetectedAt: at(33),
    })
  })

  it('no provider time is invented when the provider gives none', async () => {
    await ingestCallEvent(event({ eventType: 'MISSED' }), at(5))
    expect(call()).toMatchObject({ startedAt: null, endedAt: null, outcomeDetectedAt: at(5) })
  })
})

// ---------------------------------------------------------------------------
describe('D. customer resolution (MCR-1) and E. eligibility', () => {
  it('known caller (any format) → linked; READY', async () => {
    await ingestCallEvent(event({ eventType: 'MISSED', callerPhone: '+7 (701) 123-45-67' }))
    expect(call()).toMatchObject({ customerId: 'cust-1', remotePhoneE164: KNOWN, recoveryState: 'READY' })
  })

  it('unknown caller → stored, customerId null, still READY, no customer created', async () => {
    await ingestCallEvent(event({ eventType: 'MISSED', callerPhone: '+7 701 000 11 22' }))
    expect(call()).toMatchObject({ customerId: null, remotePhoneE164: '+77010001122', recoveryState: 'READY' })
  })

  it('ambiguous caller (two active customers share the number) → not linked', async () => {
    await ingestCallEvent(event({ eventType: 'MISSED', callerPhone: '+77015554433' }))
    expect(call()!.customerId).toBeNull()
  })

  it("same caller number as another tenant's customer → never linked across tenants", async () => {
    await ingestCallEvent(event({ eventType: 'MISSED', callerPhone: '+77019998877' }))
    expect(call()!.customerId).toBeNull()
  })

  it.each([[null], ['12345'], ['телефон']])('hidden/invalid caller %j → stored, no customer, NOT_ELIGIBLE (NO_CALLER_PHONE)', async (callerPhone) => {
    await ingestCallEvent(event({ eventType: 'MISSED', callerPhone }))
    expect(call()).toMatchObject({ remotePhoneE164: null, customerId: null, recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'NO_CALLER_PHONE' })
  })

  it('outbound → NOT_ELIGIBLE (OUTBOUND), even when unanswered', async () => {
    await ingestCallEvent(event({ direction: 'OUTBOUND', callerPhone: KZ_NUMBER, calledPhone: KNOWN, eventType: 'MISSED' }))
    expect(call()).toMatchObject({ outcome: 'MISSED', recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'OUTBOUND' })
  })

  it('in progress → PENDING (not yet decidable)', async () => {
    await ingestCallEvent(event({ eventType: 'RINGING' }))
    expect(call()).toMatchObject({ outcome: 'IN_PROGRESS', recoveryState: 'PENDING' })
  })
})

// ---------------------------------------------------------------------------
describe('B. mock adapter normalization', () => {
  const adapter = createMockTelephonyAdapter()
  const base = { eventId: 'e1', callId: 'c1', to: KZ_NUMBER, from: '87011234567' }

  it.each([
    ['call.ringing', 'RINGING'],
    ['call.answered', 'ANSWERED'],
    ['call.completed', 'COMPLETED'],
    ['call.missed', 'MISSED'],
  ])('%s → %s', (evt, type) => {
    expect(adapter.parse({ ...base, event: evt })).toMatchObject({ provider: 'mock', providerEventId: 'e1', providerCallId: 'c1', eventType: type, direction: 'INBOUND' })
  })

  it('carries the answered flag only on completed; keeps the provider timestamp; drops forged tenant fields', () => {
    const parsed = adapter.parse({ ...base, event: 'call.completed', answered: true, timestamp: '2026-10-03T09:00:00Z', tenantId: 't2', businessId: 'b2' })
    expect(parsed).toMatchObject({ wasAnswered: true, occurredAt: new Date('2026-10-03T09:00:00Z') })
    expect(parsed).not.toHaveProperty('tenantId')
    expect(parsed).not.toHaveProperty('businessId')
    expect(adapter.parse({ ...base, event: 'call.missed', answered: true }).wasAnswered).toBeNull()
  })

  it.each([['anonymous'], ['Private'], [''], [null]])('hidden caller %j → callerPhone null', (from) => {
    expect(adapter.parse({ ...base, event: 'call.missed', from }).callerPhone).toBeNull()
  })

  it.each([
    [{}],
    [{ ...base }], // no event
    [{ ...base, event: 'call.transferred' }],
    [{ ...base, event: 'call.missed', to: '' }],
    [{ ...base, event: 'call.missed', timestamp: 'yesterday' }],
    ['not json'],
  ])('malformed %j → TelephonyPayloadError', (body) => {
    expect(() => adapter.parse(body)).toThrow('Invalid mock telephony payload')
  })
})

// ---------------------------------------------------------------------------
function makeRes() {
  const res = { statusCode: 0, body: undefined as any }
  const api = {
    status(code: number) {
      res.statusCode = code
      return api
    },
    json(payload: unknown) {
      res.body = payload
      return api
    },
    setHeader() {
      return api
    },
  }
  return { res, api: api as unknown as ApiResponse }
}
async function post(body: unknown, headers: Record<string, string> = { 'x-mock-telephony-secret': SECRET }, method = 'POST') {
  const { res, api } = makeRes()
  await webhook({ method, headers, body, query: {} } as unknown as ApiRequest, api)
  return res
}
const payload = (o: Record<string, unknown> = {}) => ({ eventId: `w-${++seq}`, callId: 'call-W', event: 'call.missed', from: '87011234567', to: KZ_NUMBER, ...o })

describe('F. webhook security & responses', () => {
  it('accepted → 200 { ok, status: "accepted" }; redelivery → 200 "duplicate"; the body reveals no ids, phones or customer', async () => {
    const body = payload({ eventId: 'fixed' })
    const first = await post(body)
    const again = await post(body)
    expect(first).toMatchObject({ statusCode: 200, body: { ok: true, status: 'accepted' } })
    expect(again).toMatchObject({ statusCode: 200, body: { ok: true, status: 'duplicate' } })
    const text = JSON.stringify([first.body, again.body])
    for (const leak of ['t1', 'b1', 'cust-1', 'call-', '7011234567', KZ_NUMBER]) expect(text).not.toContain(leak)
    expect(db.calls).toHaveLength(1)
  })

  it('wrong / missing secret → 401 before anything is read or written', async () => {
    expect((await post(payload(), { 'x-mock-telephony-secret': 'nope' })).statusCode).toBe(401)
    expect((await post(payload(), {})).statusCode).toBe(401)
    expect(db.calls).toEqual([])
  })

  it('mock disabled (no secret configured) or production → 401 even with a header', async () => {
    delete process.env.TELEPHONY_MOCK_WEBHOOK_SECRET
    expect((await post(payload())).statusCode).toBe(401)
    process.env.TELEPHONY_MOCK_WEBHOOK_SECRET = SECRET
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect((await post(payload())).statusCode).toBe(401)
    } finally {
      process.env.NODE_ENV = prev
    }
    expect(db.calls).toEqual([])
  })

  it('malformed → 400; unknown number → 422; other methods → 404', async () => {
    expect((await post({ hello: 'world' })).body.error.code).toBe('INVALID_PAYLOAD')
    const unknown = await post(payload({ to: '+77272599999' }))
    expect(unknown).toMatchObject({ statusCode: 422, body: { error: { code: 'UNROUTABLE_NUMBER' } } })
    expect((await post(payload(), undefined, 'GET')).statusCode).toBe(404)
    expect(db.calls).toEqual([])
  })

  it("tenantId/businessId in the payload cannot override routing", async () => {
    await post(payload({ tenantId: 't2', businessId: 'b2' }))
    expect(db.calls[0]).toMatchObject({ tenantId: 't1', businessId: 'b1' })
  })
})
