import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 56 — booking confirmation from a CustomerRequest.
//
// The real requestBookingService + appointmentService + domain/capacity.ts
// run on a small in-memory store (same harness as appointmentCapacity.test):
// repository doubles implement the real predicates (tenant + business scope,
// half-open overlap, active statuses, the compare-and-set link), and
// runInTransaction models the per-business lock — transactions run one at a
// time and a throwing one is rolled back completely. The real lock SQL is
// pinned in tenantIsolation.test.ts and raced on Supabase (final-report-56).
// ---------------------------------------------------------------------------

type Row = Record<string, any> & { id: string; tenantId: string; businessId: string }

const { db, fail, auth, outbound } = vi.hoisted(() => ({
  db: {
    businesses: [] as Row[],
    appointments: [] as Row[],
    customers: [] as Row[],
    vehicles: [] as Row[],
    services: [] as Row[],
    requests: [] as Row[],
    history: [] as Record<string, unknown>[],
    followUps: [] as Row[],
    hours: [] as Record<string, unknown>[],
  },
  fail: { create: false, link: false },
  auth: { ctx: null as unknown as AuthContext },
  outbound: { calls: 0 },
}))

let seq = 0
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)
const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']
const overlaps = (r: Row, s: Date, e: Date) => r.startAt < e && r.endAt > s
const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

let chain: Promise<unknown> = Promise.resolve()
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = async () => {
      const snapshot = structuredClone(db)
      try {
        return await fn({ __tx: true })
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
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: {
    lockForScheduling: async (t: string, b: string) => {
      const row = db.businesses.find((r) => r.id === b && r.tenantId === t)
      return row ? { serviceBayCapacity: row.serviceBayCapacity } : null
    },
  },
}))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.appointments, t, b).find((r) => r.id === id) ?? null,
    create: async (data: Row) => {
      await tick() // lets unserialized callers interleave
      if (fail.create) {
        fail.create = false
        throw new Error('insert failed')
      }
      const row = { ...data, id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(++seq).padStart(12, '0')}`, createdAt: new Date(), updatedAt: new Date() }
      db.appointments.push(row)
      return { ...row }
    },
    findConflict: async (t: string, b: string, vehicleId: string, s: Date, e: Date, excludeId?: string) =>
      scoped(db.appointments, t, b).find((r) => r.vehicleId === vehicleId && ACTIVE.includes(r.status) && overlaps(r, s, e) && r.id !== excludeId) ?? null,
    listCapacityOccupants: async (t: string, b: string, s: Date, e: Date, excludeId?: string) =>
      scoped(db.appointments, t, b)
        .filter((r) => ACTIVE.includes(r.status) && overlaps(r, s, e) && r.id !== excludeId)
        .map((r) => ({ startAt: r.startAt, endAt: r.endAt })),
  },
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
vi.mock('../src/server/repositories/workingHoursRepository', () => ({
  workingHoursRepository: { listByBusiness: async () => db.hours },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: async (t: string, b: string, id: string) => {
      const row = scoped(db.requests, t, b).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    findByIdForUpdate: async (t: string, b: string, id: string) => {
      const row = scoped(db.requests, t, b).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    linkBookedAppointment: async (t: string, b: string, id: string, link: Record<string, any>) => {
      if (fail.link) {
        fail.link = false
        return false
      }
      const row = scoped(db.requests, t, b).find((r) => r.id === id && r.appointmentId === null && r.status === link.fromStatus)
      if (!row) return false
      Object.assign(row, { appointmentId: link.appointmentId, status: link.toStatus, updatedAt: new Date(row.updatedAt.getTime() + 1000) })
      if (link.toStatus !== link.fromStatus) {
        db.history.push({ customerRequestId: id, fromStatus: link.fromStatus, toStatus: link.toStatus, changedByUserId: link.changedByUserId })
      }
      return true
    },
  },
}))
vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({
  serviceFollowUpRepository: {
    markBookedByCustomerRequest: async (t: string, b: string, requestId: string) => {
      const rows = scoped(db.followUps, t, b).filter((f) => f.customerRequestId === requestId && ['PENDING', 'CONTACTED'].includes(f.status))
      for (const f of rows) f.status = 'BOOKED'
      return rows.length
    },
  },
}))
// Customer-facing output must never be produced by a booking.
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: new Proxy({}, { get: () => () => { outbound.calls++; throw new Error('no message may be written') } }),
}))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({
  channelDeliveryRepository: new Proxy({}, { get: () => () => { outbound.calls++; throw new Error('no delivery may be written') } }),
}))
vi.mock('../src/server/middleware/requireAuth', () => ({
  requireAuth: async () => {
    if (auth.ctx) return auth.ctx
    const { ApiError } = await import('../src/server/lib/errors')
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required')
  },
}))

import { confirmRequestBooking, getRequestBooking, bookingMissing, bookingTargetStatus } from '../src/server/services/requestBookingService'
import { createAppointment, checkAvailability } from '../src/server/services/appointmentService'
import { businessLocalToUtc } from '../src/server/lib/timezone'
import { ApiError } from '../src/server/lib/errors'
import bookingHandler from '../api/customer-requests/[id]/booking'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const NOW = new Date('2026-10-01T06:00:00Z') // Thursday morning, Moscow
const DAY = '2026-10-05' // a Monday
const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const OTHER_CUSTOMER = '11111111-1111-4111-8111-222222222222'
const SERVICE = '33333333-3333-4333-8333-333333333333' // 60 min
const LONG_SERVICE = '33333333-3333-4333-8333-444444444444' // 90 min
const FOREIGN_SERVICE = '34333333-3333-4333-8333-333333333333'
const vehicle = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
const FOREIGN_VEHICLE = vehicle(999)
const request = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`
const FOREIGN_REQUEST = request(999)
const T0 = new Date('2026-09-30T10:00:00Z')

const STANDARD_WEEK = [
  ...['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((dayOfWeek) => ({ dayOfWeek, isOpen: true, openTime: '09:00', closeTime: '18:00' })),
  { dayOfWeek: 'SATURDAY', isOpen: true, openTime: '10:00', closeTime: '15:00' },
  { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
]

function contextFor(capacity = 1): AuthContext {
  db.businesses.find((b) => b.id === 'b1')!.serviceBayCapacity = capacity
  return makeAuthContext('manager', { business: makeBusiness({ serviceBayCapacity: capacity }) })
}
const foreignCtx = () => makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2' }) })
const at = (hhmm: string, date = DAY) => businessLocalToUtc(date, hhmm, 'Europe/Moscow')

function seedRequest(n: number, overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: request(n),
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER,
    vehicleId: vehicle(n),
    serviceId: SERVICE,
    appointmentId: null,
    source: 'MANUAL',
    status: 'QUALIFIED',
    subject: `Проверка P56 ${n}`,
    description: null,
    requestedDate: new Date(Date.UTC(2026, 9, 5)),
    requestedTimeFrom: '15:00',
    requestedTimeTo: null,
    notes: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }
  db.requests.push(row)
  return row
}
function seedAppointment(v: number, from: string, to: string, status = 'SCHEDULED'): Row {
  const row: Row = { id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, vehicleId: vehicle(v), serviceId: SERVICE, startAt: at(from), endAt: at(to), status, notes: null }
  db.appointments.push(row)
  return row
}
const confirmInput = (hhmm: string, row: Row) => ({ startAt: at(hhmm), expectedRequestUpdatedAt: row.updatedAt })
const req = (n: number) => db.requests.find((r) => r.id === request(n))!

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  return err as ApiError
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  seq = 0
  fail.create = false
  fail.link = false
  outbound.calls = 0
  auth.ctx = null as unknown as AuthContext
  db.businesses = [
    { id: 'b1', tenantId: 't1', businessId: 'b1', serviceBayCapacity: 1 },
    { id: 'b2', tenantId: 't2', businessId: 'b2', serviceBayCapacity: 1 },
  ]
  db.appointments = []
  db.customers = [
    { id: CUSTOMER, tenantId: 't1', businessId: 'b1', firstName: 'Проверка', lastName: 'P56', phone: '+79990000056', isActive: true },
    { id: OTHER_CUSTOMER, tenantId: 't1', businessId: 'b1', firstName: 'Другой', lastName: null, phone: '+79990000057', isActive: true },
  ]
  db.vehicles = Array.from({ length: 12 }, (_, i) => ({
    id: vehicle(i + 1),
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER,
    make: 'Kia',
    model: 'Rio',
    year: 2019,
    licensePlate: null,
    vin: null,
    isActive: true,
  }))
  db.vehicles.push({ id: FOREIGN_VEHICLE, tenantId: 't2', businessId: 'b2', customerId: 'foreign', make: 'X', model: 'Y', year: null, licensePlate: null, isActive: true })
  db.services = [
    { id: SERVICE, tenantId: 't1', businessId: 'b1', name: 'Замена масла', isActive: true, durationMinutes: 60 },
    { id: LONG_SERVICE, tenantId: 't1', businessId: 'b1', name: 'Диагностика', isActive: true, durationMinutes: 90 },
    { id: FOREIGN_SERVICE, tenantId: 't2', businessId: 'b2', name: 'Чужая', isActive: true, durationMinutes: 60 },
  ]
  db.requests = []
  db.history = []
  db.followUps = []
  db.hours = STANDARD_WEEK
})
afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
describe('readiness', () => {
  it('a request with customer, vehicle and service is booking-ready', async () => {
    const ctx = contextFor()
    seedRequest(1)
    const view = await getRequestBooking(ctx, request(1))
    expect(view).toMatchObject({
      state: 'ready',
      missing: [],
      convertsRequest: true,
      customer: { name: 'Проверка P56', isActive: true },
      vehicle: { label: 'Kia Rio (2019)', isActive: true },
      service: { name: 'Замена масла', durationMinutes: 60, isActive: true },
      preference: { date: DAY, timeFrom: '15:00', timeTo: null },
      appointment: null,
    })
  })

  it('missing customer / vehicle / service are named; inactive ones too', () => {
    expect(bookingMissing(null, { isActive: true }, { isActive: true })).toEqual(['клиент'])
    expect(bookingMissing({ isActive: true }, null, { isActive: true })).toEqual(['автомобиль'])
    expect(bookingMissing({ isActive: true }, { isActive: true }, null)).toEqual(['услуга'])
    expect(bookingMissing({ isActive: true }, null, null)).toEqual(['автомобиль', 'услуга'])
    expect(bookingMissing({ isActive: false }, { isActive: false }, { isActive: false })).toEqual(['активный клиент', 'активный автомобиль', 'активная услуга'])
  })

  it('missing vehicle or service → not_ready, and a confirmation is refused (400 BOOKING_NOT_READY), nothing written', async () => {
    const ctx = contextFor()
    seedRequest(1, { vehicleId: null })
    seedRequest(2, { serviceId: null })
    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'not_ready', missing: ['автомобиль'] })
    expect(await getRequestBooking(ctx, request(2))).toMatchObject({ state: 'not_ready', missing: ['услуга'] })

    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 400, code: 'BOOKING_NOT_READY', message: 'Для записи не хватает: автомобиль.' })
    expect(db.appointments).toHaveLength(0)
  })

  it('no preferred date is not a blocker — the operator picks the date (the domain books an interval, not a wish)', async () => {
    const ctx = contextFor()
    seedRequest(1, { requestedDate: null, requestedTimeFrom: null })
    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'ready', preference: { date: null, timeFrom: null, timeTo: null } })
    await expect(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))).resolves.toMatchObject({ created: true })
  })

  it('VIN and plate are never required', async () => {
    const ctx = contextFor()
    seedRequest(1)
    const v = db.vehicles.find((x) => x.id === vehicle(1))!
    expect(v.vin).toBeNull()
    expect(v.licensePlate).toBeNull()
    expect((await getRequestBooking(ctx, request(1))).missing).toEqual([])
  })

  it('a closed or cancelled request without appointment is "closed" and cannot be booked', async () => {
    const ctx = contextFor()
    seedRequest(1, { status: 'CLOSED' })
    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'closed' })
    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 409, code: 'REQUEST_FINISHED' })
    expect(db.appointments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('availability — the canonical Prompt 51 generator', () => {
  it('uses business hours, service duration and the vehicle; the preference reserves nothing', async () => {
    const ctx = contextFor()
    seedRequest(1)
    const { slots } = await checkAvailability(ctx, { serviceId: SERVICE, date: DAY, vehicleId: vehicle(1) })
    expect(slots[0]!.localStart).toBe('09:00')
    expect(slots.at(-1)!.localStart).toBe('17:00') // 60 min before 18:00 closing
    expect(slots.map((s) => s.localStart)).toContain('10:00') // before the 15:00 wish — still offered

    // Another vehicle takes 15:00 although the request "wanted after 15:00": allowed, the wish is no hold.
    await createAppointment(ctx, { customerId: CUSTOMER, vehicleId: vehicle(5), serviceId: SERVICE, startAt: at('15:00'), endAt: at('16:00') } as never)
    const after = await checkAvailability(ctx, { serviceId: SERVICE, date: DAY, vehicleId: vehicle(1) })
    expect(after.slots.map((s) => s.localStart)).not.toContain('15:00')
  })

  it('the 90-minute service ends its last slot at closing', async () => {
    const ctx = contextFor()
    const { slots } = await checkAvailability(ctx, { serviceId: LONG_SERVICE, date: DAY })
    expect(slots.at(-1)).toMatchObject({ localStart: '16:30', localEnd: '18:00' })
  })
})

// ---------------------------------------------------------------------------
describe('confirmation — the mutation boundary', () => {
  it("reading the booking state writes nothing (selecting a slot is client-side only)", async () => {
    const ctx = contextFor()
    seedRequest(1)
    const before = structuredClone(db)
    await getRequestBooking(ctx, request(1))
    await checkAvailability(ctx, { serviceId: SERVICE, date: DAY, vehicleId: vehicle(1) })
    expect(db).toEqual(before)
  })

  it("explicit confirmation books the request's own customer, vehicle and service for the service duration", async () => {
    const ctx = contextFor()
    seedRequest(1)

    const result = await confirmRequestBooking(ctx, request(1), confirmInput('15:30', req(1)))

    expect(result.created).toBe(true)
    expect(db.appointments).toHaveLength(1)
    const appt = db.appointments[0]!
    expect(appt).toMatchObject({ tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, vehicleId: vehicle(1), serviceId: SERVICE, status: 'SCHEDULED' })
    expect(appt.startAt).toEqual(at('15:30'))
    expect(appt.endAt).toEqual(at('16:30'))
    expect(result.booking).toMatchObject({
      state: 'booked',
      requestStatus: 'CONVERTED',
      appointment: { id: appt.id, localDate: DAY, localStart: '15:30', localEnd: '16:30', vehicleLabel: 'Kia Rio (2019)', serviceName: 'Замена масла' },
    })
  })

  it('QUALIFIED → CONVERTED with one history row by the operator; the linked follow-up becomes BOOKED in the same step', async () => {
    const ctx = contextFor()
    seedRequest(1)
    db.followUps.push({ id: 'f1', tenantId: 't1', businessId: 'b1', customerRequestId: request(1), status: 'CONTACTED' })

    await confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))

    expect(req(1)).toMatchObject({ status: 'CONVERTED', appointmentId: db.appointments[0]!.id })
    expect(db.history).toEqual([{ customerRequestId: request(1), fromStatus: 'QUALIFIED', toStatus: 'CONVERTED', changedByUserId: 'u1' }])
    expect(db.followUps[0]!.status).toBe('BOOKED')
  })

  it.each(['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER'])('%s: booked and linked, status unchanged (no fake transition), no history row', async (status) => {
    const ctx = contextFor()
    seedRequest(1, { status })

    const result = await confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))

    expect(result.booking).toMatchObject({ state: 'booked', requestStatus: status })
    expect(req(1)).toMatchObject({ status, appointmentId: db.appointments[0]!.id })
    expect(db.history).toEqual([])
  })

  it('the transition rule is the request lifecycle: only QUALIFIED converts', () => {
    expect(bookingTargetStatus('QUALIFIED')).toBe('CONVERTED')
    for (const s of ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER'] as const) expect(bookingTargetStatus(s)).toBe(s)
  })

  it('no message, channel delivery or Telegram call is made', async () => {
    const ctx = contextFor()
    seedRequest(1)
    await confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))
    expect(outbound.calls).toBe(0)
  })

  it('a time that has already passed is refused (409 BOOKING_TIME_PASSED), nothing written', async () => {
    const ctx = contextFor()
    seedRequest(1)
    const err = await errorOf(confirmRequestBooking(ctx, request(1), { startAt: new Date(NOW.getTime() - 60_000), expectedRequestUpdatedAt: T0 }))
    expect(err).toMatchObject({ statusCode: 409, code: 'BOOKING_TIME_PASSED' })
    expect(db.appointments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('idempotency and races', () => {
  it('double confirm (sequential): one appointment; the second returns it with created:false', async () => {
    const ctx = contextFor()
    seedRequest(1)
    const first = await confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))
    const second = await confirmRequestBooking(ctx, request(1), { startAt: at('11:00'), expectedRequestUpdatedAt: T0 })

    expect(first.created).toBe(true)
    expect(second).toMatchObject({ created: false, booking: { state: 'booked', appointment: { id: first.booking.appointment!.id } } })
    expect(db.appointments).toHaveLength(1)
  })

  it('same request, 5 parallel confirmations (two tabs, retries): exactly one appointment, no error', async () => {
    const ctx = contextFor(5)
    seedRequest(1)
    const snapshot = { ...req(1) }

    const results = await Promise.all(['10:00', '10:00', '11:00', '12:00', '13:00'].map((t) => confirmRequestBooking(ctx, request(1), confirmInput(t, snapshot))))

    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(db.appointments).toHaveLength(1)
    expect(new Set(results.map((r) => r.booking.appointment!.id)).size).toBe(1)
    expect(db.history).toHaveLength(1)
  })

  it('capacity 1, two requests, the same final slot in parallel: one booked, the other 409 CAPACITY_EXCEEDED and left unconverted', async () => {
    const ctx = contextFor(1)
    seedRequest(1)
    seedRequest(2)

    const results = await Promise.allSettled([
      confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))),
      confirmRequestBooking(ctx, request(2), confirmInput('10:00', req(2))),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(bad).toHaveLength(1)
    expect(bad[0]!.reason).toMatchObject({ statusCode: 409, code: 'CAPACITY_EXCEEDED', message: 'Это время уже занято. Выберите другое свободное время.' })
    expect(db.appointments).toHaveLength(1)
    const loser = db.requests.find((r) => r.appointmentId === null)!
    expect(loser.status).toBe('QUALIFIED')
  })

  it('same vehicle on two requests, overlapping times in parallel (posts free): one booked, the other 409 APPOINTMENT_CONFLICT', async () => {
    const ctx = contextFor(3)
    seedRequest(1)
    seedRequest(2, { vehicleId: vehicle(1) })

    const results = await Promise.allSettled([
      confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))),
      confirmRequestBooking(ctx, request(2), confirmInput('10:30', req(2))),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const bad = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!
    expect(bad.reason).toMatchObject({ statusCode: 409, code: 'APPOINTMENT_CONFLICT', message: 'Автомобиль уже записан на это время. Выберите другое свободное время.' })
    expect(bad.reason.details).toBeUndefined()
    expect(db.appointments).toHaveLength(1)
  })

  it('stale slot: someone took the last post after it was shown → 409, request unchanged, no orphan appointment', async () => {
    const ctx = contextFor(1)
    seedRequest(1)
    const before = { ...req(1) }
    seedAppointment(9, '10:00', '11:00') // the admin path took the post

    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))

    expect(err.code).toBe('CAPACITY_EXCEEDED')
    expect(req(1)).toEqual(before)
    expect(db.appointments).toHaveLength(1)
    expect(db.history).toHaveLength(0)
  })

  it('a failed insert leaves no appointment and no CONVERTED request', async () => {
    const ctx = contextFor()
    seedRequest(1)
    fail.create = true

    await expect(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1)))).rejects.toThrow('insert failed')
    expect(db.appointments).toHaveLength(0)
    expect(req(1)).toMatchObject({ status: 'QUALIFIED', appointmentId: null })
  })

  it('a failed link (row changed under us) rolls the appointment back: 409 BOOKING_STALE, no orphan', async () => {
    const ctx = contextFor()
    seedRequest(1)
    fail.link = true

    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 409, code: 'BOOKING_STALE' })
    expect(db.appointments).toHaveLength(0)
    expect(req(1)).toMatchObject({ status: 'QUALIFIED', appointmentId: null })
    expect(db.history).toHaveLength(0)
  })

  it('the request changed after the operator looked (version mismatch) → 409 BOOKING_STALE, nothing booked', async () => {
    const ctx = contextFor()
    const row = seedRequest(1)
    const seen = row.updatedAt
    row.vehicleId = vehicle(2)
    row.updatedAt = new Date(seen.getTime() + 5000)

    const err = await errorOf(confirmRequestBooking(ctx, request(1), { startAt: at('10:00'), expectedRequestUpdatedAt: seen }))
    expect(err).toMatchObject({ statusCode: 409, code: 'BOOKING_STALE', message: 'Данные заявки изменились. Обновите страницу и попробуйте ещё раз.' })
    expect(db.appointments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('state changed since the slots were shown — the server decides', () => {
  it('service deactivated → 400 SERVICE_INACTIVE, never substituted', async () => {
    const ctx = contextFor()
    seedRequest(1)
    db.services.find((s) => s.id === SERVICE)!.isActive = false

    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'not_ready', missing: ['активная услуга'] })
    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 400, code: 'SERVICE_INACTIVE', message: 'Услуга больше недоступна для записи. Выберите другую услугу.' })
    expect(db.appointments).toHaveLength(0)
  })

  it('business hours changed (Monday now closed) → 409 OUTSIDE_WORKING_HOURS, nothing booked', async () => {
    const ctx = contextFor()
    seedRequest(1)
    db.hours = STANDARD_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, isOpen: false, openTime: null, closeTime: null } : d))

    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 409, code: 'OUTSIDE_WORKING_HOURS' })
    expect(db.appointments).toHaveLength(0)
  })

  it('capacity lowered by an admin since the page loaded → the locked capacity wins', async () => {
    const ctx = contextFor(2) // the session saw 2 posts
    seedRequest(1)
    seedAppointment(9, '10:00', '11:00')
    db.businesses.find((b) => b.id === 'b1')!.serviceBayCapacity = 1

    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err.code).toBe('CAPACITY_EXCEEDED')
  })

  it('an already-booked request never books again and shows its appointment', async () => {
    const ctx = contextFor()
    const appt = seedAppointment(1, '12:00', '13:00')
    seedRequest(1, { status: 'CONVERTED', appointmentId: appt.id })

    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'booked', appointment: { id: appt.id, localStart: '12:00' } })
    const result = await confirmRequestBooking(ctx, request(1), confirmInput('15:00', req(1)))
    expect(result).toMatchObject({ created: false, booking: { appointment: { id: appt.id } } })
    expect(db.appointments).toHaveLength(1)
  })

  it('a cancelled linked appointment stays linked: no replacement booking, status not reverted', async () => {
    const ctx = contextFor()
    const appt = seedAppointment(1, '12:00', '13:00', 'CANCELLED')
    seedRequest(1, { status: 'CONVERTED', appointmentId: appt.id })

    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'booked', requestStatus: 'CONVERTED', appointment: { status: 'CANCELLED' } })
    await confirmRequestBooking(ctx, request(1), confirmInput('15:00', req(1)))
    expect(db.appointments).toHaveLength(1)
  })

  it('CONVERTED without an appointment (inconsistent legacy data) → warning state, 409, nothing created', async () => {
    const ctx = contextFor()
    seedRequest(1, { status: 'CONVERTED' })

    expect(await getRequestBooking(ctx, request(1))).toMatchObject({ state: 'inconsistent' })
    const err = await errorOf(confirmRequestBooking(ctx, request(1), confirmInput('10:00', req(1))))
    expect(err).toMatchObject({ statusCode: 409, code: 'REQUEST_INCONSISTENT' })
    expect(db.appointments).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
function makeReq(method: string, id: string, body?: unknown): ApiRequest {
  return { method, query: { id }, body, headers: {} } as unknown as ApiRequest
}
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
async function call(method: string, id: string, body?: unknown) {
  const { res, api } = makeRes()
  await bookingHandler(makeReq(method, id, body), api)
  return res
}

describe('GET/POST /api/customer-requests/:id/booking', () => {
  it('unauthenticated → 401 for both methods, nothing written', async () => {
    seedRequest(1)
    expect((await call('GET', request(1))).statusCode).toBe(401)
    expect((await call('POST', request(1), { startAt: at('10:00').toISOString(), expectedRequestUpdatedAt: T0.toISOString() })).statusCode).toBe(401)
    expect(db.appointments).toHaveLength(0)
  })

  it('confirms with only { startAt, expectedRequestUpdatedAt } → 201, then a repeat → 200 created:false', async () => {
    auth.ctx = contextFor()
    seedRequest(1)
    const body = { startAt: at('10:00').toISOString(), expectedRequestUpdatedAt: T0.toISOString() }

    const first = await call('POST', request(1), body)
    expect(first.statusCode).toBe(201)
    expect(first.body).toMatchObject({ created: true, booking: { state: 'booked' } })
    const second = await call('POST', request(1), body)
    expect(second.statusCode).toBe(200)
    expect(second.body).toMatchObject({ created: false })
    expect(db.appointments).toHaveLength(1)
  })

  it('crafted ids in the body (customer/vehicle/service/appointment/tenant) are rejected — 400, nothing written', async () => {
    auth.ctx = contextFor()
    seedRequest(1)
    const base = { startAt: at('10:00').toISOString(), expectedRequestUpdatedAt: T0.toISOString() }
    for (const extra of [
      { customerId: OTHER_CUSTOMER },
      { vehicleId: FOREIGN_VEHICLE },
      { serviceId: FOREIGN_SERVICE },
      { appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' },
      { tenantId: 't2' },
      { endAt: at('17:00').toISOString() },
    ]) {
      const res = await call('POST', request(1), { ...base, ...extra })
      expect(res.statusCode).toBe(400)
    }
    expect(db.appointments).toHaveLength(0)
  })

  it("another tenant's request is 404 for GET and POST — no booking state leaks, nothing written", async () => {
    auth.ctx = contextFor()
    seedRequest(999, { tenantId: 't2', businessId: 'b2', customerId: 'foreign', vehicleId: FOREIGN_VEHICLE, serviceId: FOREIGN_SERVICE })

    expect((await call('GET', FOREIGN_REQUEST)).statusCode).toBe(404)
    const post = await call('POST', FOREIGN_REQUEST, { startAt: at('10:00').toISOString(), expectedRequestUpdatedAt: T0.toISOString() })
    expect(post.statusCode).toBe(404)
    expect(db.appointments).toHaveLength(0)
  })

  it('a request of tenant 1 is invisible to tenant 2 through the service too', async () => {
    seedRequest(1)
    await expect(getRequestBooking(foreignCtx(), request(1))).rejects.toMatchObject({ statusCode: 404 })
    await expect(confirmRequestBooking(foreignCtx(), request(1), confirmInput('10:00', req(1)))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('malformed id → 404, malformed startAt → 400, other methods → 405', async () => {
    auth.ctx = contextFor()
    seedRequest(1)
    expect((await call('GET', 'not-a-uuid')).statusCode).toBe(404)
    expect((await call('POST', request(1), { startAt: '2026-10-05 10:00', expectedRequestUpdatedAt: T0.toISOString() })).statusCode).toBe(400)
    expect((await call('DELETE', request(1))).statusCode).toBe(405)
  })
})

// ---------------------------------------------------------------------------
describe('regression — the canonical appointment paths are unchanged', () => {
  it('create without hooks and reschedule still work and still enforce capacity', async () => {
    const ctx = contextFor(1)
    const a = await createAppointment(ctx, { customerId: CUSTOMER, vehicleId: vehicle(1), serviceId: SERVICE, startAt: at('10:00'), endAt: at('11:00') } as never)
    await expect(
      createAppointment(ctx, { customerId: CUSTOMER, vehicleId: vehicle(2), serviceId: SERVICE, startAt: at('10:30'), endAt: at('11:30') } as never)
    ).rejects.toMatchObject({ code: 'CAPACITY_EXCEEDED' })
    expect(a.id).toBeDefined()
    expect(db.appointments).toHaveLength(1)
    // Reschedule is covered unchanged by appointmentCapacity.test (its double implements updateById).
  })
})
