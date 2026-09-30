import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'
import type { AuthContext } from '../src/server/types/auth'

// ---------------------------------------------------------------------------
// Prompt 50 — service-bay capacity on appointment create / reschedule, the
// interval availability check, the slot generator and
// GET /api/appointments/availability.
//
// The real appointmentService + domain/capacity.ts run on a small in-memory
// store. The repository doubles implement the same predicates as the real
// queries (half-open overlap, active statuses, tenant + business scope, the
// 24 h lookback). runInTransaction is a faithful model of the per-business
// lock: transactions run one at a time and a throwing one is rolled back —
// what SELECT … FOR NO KEY UPDATE on the business row guarantees. The real
// lock SQL is pinned in tenantIsolation.test.ts and raced on Supabase (see
// final-report-50.md).
// ---------------------------------------------------------------------------

type Row = Record<string, any> & { id: string; tenantId: string; businessId: string }

const { db, fail, auth } = vi.hoisted(() => ({
  db: {
    businesses: [] as Row[],
    appointments: [] as Row[],
    customers: [] as Row[],
    vehicles: [] as Row[],
    services: [] as Row[],
    hours: [] as Record<string, unknown>[],
  },
  fail: { create: false },
  auth: { ctx: null as unknown as AuthContext },
}))

let seq = 0
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)
const ACTIVE = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']
const overlaps = (r: Row, s: Date, e: Date) => r.startAt < e && r.endAt > s

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
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
  appointmentRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.appointments, t, b).find((r) => r.id === id) ?? null,
    create: async (data: Row) => {
      await new Promise((resolve) => setTimeout(resolve, 1)) // lets unserialized callers interleave
      if (fail.create) {
        fail.create = false
        throw new Error('insert failed')
      }
      const row = { ...data, id: `apt-${++seq}` }
      db.appointments.push(row)
      return { ...row }
    },
    updateById: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      const row = scoped(db.appointments, t, b).find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
    findConflict: async (t: string, b: string, vehicleId: string, s: Date, e: Date, excludeId?: string) =>
      scoped(db.appointments, t, b).find(
        (r) => r.vehicleId === vehicleId && ACTIVE.includes(r.status) && overlaps(r, s, e) && r.id !== excludeId
      ) ?? null,
    listCapacityOccupants: async (t: string, b: string, s: Date, e: Date, excludeId?: string) =>
      scoped(db.appointments, t, b)
        .filter((r) => ACTIVE.includes(r.status) && overlaps(r, s, e) && r.startAt > new Date(s.getTime() - 86_400_000) && r.id !== excludeId)
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
vi.mock('../src/server/middleware/requireAuth', () => ({ requireAuth: async () => auth.ctx }))

import {
  createAppointment,
  updateAppointment,
  checkAvailability,
  checkIntervalAvailability,
  getIntervalCapacity,
} from '../src/server/services/appointmentService'
import { businessLocalToUtc } from '../src/server/lib/timezone'
import { ApiError } from '../src/server/lib/errors'
import availabilityHandler from '../api/appointments/availability'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

const DAY = '2026-10-05' // a Monday
const CUSTOMER = '11111111-1111-4111-8111-111111111111'
const SERVICE = '33333333-3333-4333-8333-333333333333' // 60 min
const FOREIGN_SERVICE = '34333333-3333-4333-8333-333333333333'
const vehicle = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`
const FOREIGN_VEHICLE = vehicle(999)
const CAPACITY_MESSAGE = 'На выбранное время нет свободных постов.'

const STANDARD_WEEK = [
  ...['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((dayOfWeek) => ({ dayOfWeek, isOpen: true, openTime: '09:00', closeTime: '18:00' })),
  { dayOfWeek: 'SATURDAY', isOpen: true, openTime: '10:00', closeTime: '15:00' },
  { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
]

function contextFor(capacity: number, timezone = 'Europe/Moscow'): AuthContext {
  const row = db.businesses.find((b) => b.id === 'b1')!
  row.serviceBayCapacity = capacity
  row.timezone = timezone
  return makeAuthContext('manager', { business: makeBusiness({ serviceBayCapacity: capacity, timezone }) })
}
const foreignCtx = () =>
  makeAuthContext('owner', { tenant: makeTenant({ id: 't2' }), business: makeBusiness({ id: 'b2', tenantId: 't2', serviceBayCapacity: 1 }) })

const local = (ctx: AuthContext, hhmm: string, date = DAY) => businessLocalToUtc(date, hhmm, ctx.business.timezone)
const input = (ctx: AuthContext, v: number, from: string, to: string) =>
  ({ customerId: CUSTOMER, vehicleId: vehicle(v), serviceId: SERVICE, startAt: local(ctx, from), endAt: local(ctx, to) }) as never

function seedAppointment(ctx: AuthContext, v: number, from: string, to: string, status = 'SCHEDULED', tenantId = 't1', businessId = 'b1'): Row {
  const row: Row = { id: `seed-${++seq}`, tenantId, businessId, customerId: CUSTOMER, vehicleId: vehicle(v), serviceId: SERVICE, startAt: local(ctx, from), endAt: local(ctx, to), status, notes: null }
  db.appointments.push(row)
  return row
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  return err as ApiError
}
async function expectCapacityExceeded(promise: Promise<unknown>) {
  const err = await errorOf(promise)
  expect(err).toMatchObject({ statusCode: 409, code: 'CAPACITY_EXCEEDED', message: CAPACITY_MESSAGE })
  expect(err.details).toBeUndefined()
}
const activeIn = (ctx: AuthContext, from: string, to: string) =>
  db.appointments.filter((r) => r.tenantId === 't1' && ACTIVE.includes(r.status) && overlaps(r, local(ctx, from), local(ctx, to))).length

beforeEach(() => {
  seq = 0
  fail.create = false
  db.businesses = [
    { id: 'b1', tenantId: 't1', businessId: 'b1', serviceBayCapacity: 1, timezone: 'Europe/Moscow' },
    { id: 'b2', tenantId: 't2', businessId: 'b2', serviceBayCapacity: 1, timezone: 'Europe/Moscow' },
  ]
  db.appointments = []
  db.customers = [{ id: CUSTOMER, tenantId: 't1', businessId: 'b1', isActive: true }]
  db.vehicles = Array.from({ length: 12 }, (_, i) => ({ id: vehicle(i + 1), tenantId: 't1', businessId: 'b1', customerId: CUSTOMER, isActive: true }))
  db.vehicles.push({ id: FOREIGN_VEHICLE, tenantId: 't2', businessId: 'b2', customerId: 'foreign', isActive: true })
  db.services = [
    { id: SERVICE, tenantId: 't1', businessId: 'b1', isActive: true, durationMinutes: 60 },
    { id: FOREIGN_SERVICE, tenantId: 't2', businessId: 'b2', isActive: true, durationMinutes: 60 },
  ]
  db.hours = STANDARD_WEEK
})

describe('create — capacity 1', () => {
  it('the first appointment fits', async () => {
    const ctx = contextFor(1)
    await expect(createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))).resolves.toMatchObject({ status: 'SCHEDULED' })
  })

  it('a second overlapping appointment (another vehicle) is refused: 409 CAPACITY_EXCEEDED, Russian, nothing written', async () => {
    const ctx = contextFor(1)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))

    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '10:30', '11:30')))
    expect(db.appointments).toHaveLength(1)
  })

  it('half-open: an adjacent appointment (11:00–12:00 after 10:00–11:00) fits', async () => {
    const ctx = contextFor(1)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    await expect(createAppointment(ctx, input(ctx, 2, '11:00', '12:00'))).resolves.toBeDefined()
    await expect(createAppointment(ctx, input(ctx, 3, '09:00', '10:00'))).resolves.toBeDefined()
  })

  it('half-open: one minute of overlap (10:59–12:00) is refused', async () => {
    const ctx = contextFor(1)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '10:59', '12:00')))
  })
})

describe('which statuses take a post', () => {
  it.each([
    ['SCHEDULED', true],
    ['CONFIRMED', true],
    ['IN_PROGRESS', true],
    ['COMPLETED', false],
    ['CANCELLED', false],
    ['NO_SHOW', false],
  ])('an existing %s appointment consumes capacity: %s', async (status, consumes) => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '10:00', '11:00', status)
    const attempt = createAppointment(ctx, input(ctx, 2, '10:00', '11:00'))
    if (consumes) await expectCapacityExceeded(attempt)
    else await expect(attempt).resolves.toBeDefined()
  })

  it('cancelling an appointment frees its post for the same interval', async () => {
    const ctx = contextFor(1)
    const first = await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '10:00', '11:00')))

    await updateAppointment(ctx, first.id, { status: 'CANCELLED' })
    await expect(createAppointment(ctx, input(ctx, 2, '10:00', '11:00'))).resolves.toBeDefined()
  })
})

describe('capacity > 1', () => {
  it('capacity 2: two vehicles may overlap, a third is refused', async () => {
    const ctx = contextFor(2)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    await createAppointment(ctx, input(ctx, 2, '10:30', '11:30'))
    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 3, '10:45', '11:15')))
  })

  it('capacity 2: back-to-back bookings never run together, so 10:00–11:00 still fits (peak, not count)', async () => {
    const ctx = contextFor(2)
    seedAppointment(ctx, 1, '10:00', '10:30')
    seedAppointment(ctx, 2, '10:30', '11:00')
    await expect(createAppointment(ctx, input(ctx, 3, '10:00', '11:00'))).resolves.toBeDefined()
  })
})

describe('vehicle conflict and business hours stay separate rules', () => {
  it('capacity 3 with free posts: the same vehicle still cannot overlap itself (APPOINTMENT_CONFLICT, not capacity)', async () => {
    const ctx = contextFor(3)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    const err = await errorOf(createAppointment(ctx, input(ctx, 1, '10:30', '11:30')))
    expect(err).toMatchObject({ statusCode: 409, code: 'APPOINTMENT_CONFLICT' })
  })

  it('free capacity never overrides opening hours (before opening, after closing, closed day)', async () => {
    const ctx = contextFor(5)
    expect(await errorOf(createAppointment(ctx, input(ctx, 1, '08:00', '09:00')))).toMatchObject({ statusCode: 400 })
    expect(await errorOf(createAppointment(ctx, input(ctx, 1, '17:30', '18:30')))).toMatchObject({ statusCode: 400 })
    const sunday = { ...(input(ctx, 1, '10:00', '11:00') as object), startAt: local(ctx, '10:00', '2026-10-04'), endAt: local(ctx, '11:00', '2026-10-04') }
    expect(await errorOf(createAppointment(ctx, sunday as never))).toMatchObject({ statusCode: 400 })
    expect(db.appointments).toHaveLength(0)
  })

  it('near closing: an appointment ending exactly at closing time fits, and capacity applies there too', async () => {
    const ctx = contextFor(1)
    await expect(createAppointment(ctx, input(ctx, 1, '17:00', '18:00'))).resolves.toBeDefined()
    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '17:30', '18:00')))
  })
})

describe('update / reschedule', () => {
  it('rescheduling into a full interval is refused and the appointment stays where it was', async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '10:00', '11:00')
    const mine = seedAppointment(ctx, 2, '12:00', '13:00')

    await expectCapacityExceeded(updateAppointment(ctx, mine.id, { startAt: local(ctx, '10:30'), endAt: local(ctx, '11:30') }))
    expect(mine.startAt).toEqual(local(ctx, '12:00'))
  })

  it('rescheduling into a free interval works', async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '10:00', '11:00')
    const mine = seedAppointment(ctx, 2, '12:00', '13:00')

    await expect(updateAppointment(ctx, mine.id, { startAt: local(ctx, '11:00'), endAt: local(ctx, '12:00') })).resolves.toBeDefined()
  })

  it('a longer duration (new endAt) that runs into another booking is refused', async () => {
    const ctx = contextFor(1)
    const mine = seedAppointment(ctx, 1, '10:00', '11:00')
    seedAppointment(ctx, 2, '11:00', '12:00')

    await expectCapacityExceeded(updateAppointment(ctx, mine.id, { endAt: local(ctx, '11:30') }))
  })

  it('an appointment never counts against itself (capacity 1, shifting it by 30 min over its own old slot)', async () => {
    const ctx = contextFor(1)
    const mine = seedAppointment(ctx, 1, '10:00', '11:00')

    await expect(updateAppointment(ctx, mine.id, { startAt: local(ctx, '10:30'), endAt: local(ctx, '11:30') })).resolves.toBeDefined()
  })

  it('status-only and notes-only edits never hit capacity, even in a legacy over-booked slot', async () => {
    const ctx = contextFor(1)
    const a = seedAppointment(ctx, 1, '10:00', '11:00')
    seedAppointment(ctx, 2, '10:00', '11:00') // pre-existing over-booking, kept as-is

    await expect(updateAppointment(ctx, a.id, { status: 'CONFIRMED' })).resolves.toMatchObject({ status: 'CONFIRMED' })
    await expect(updateAppointment(ctx, a.id, { status: 'IN_PROGRESS', notes: 'Начали' })).resolves.toMatchObject({ status: 'IN_PROGRESS' })
  })

  it('changing only the service or vehicle on the same interval takes no extra post', async () => {
    const ctx = contextFor(1)
    const a = seedAppointment(ctx, 1, '10:00', '11:00')
    seedAppointment(ctx, 2, '10:00', '11:00') // legacy over-booking

    await expect(updateAppointment(ctx, a.id, { vehicleId: vehicle(3) })).resolves.toMatchObject({ vehicleId: vehicle(3) })
  })

  it('moving and cancelling in one PATCH frees a post — no capacity check', async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '10:00', '11:00')
    const mine = seedAppointment(ctx, 2, '12:00', '13:00')

    await expect(
      updateAppointment(ctx, mine.id, { status: 'CANCELLED', startAt: local(ctx, '10:00'), endAt: local(ctx, '11:00') })
    ).resolves.toMatchObject({ status: 'CANCELLED' })
  })
})

describe('tenant isolation', () => {
  it("another tenant's appointments at the same time are never counted", async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 999, '10:00', '11:00', 'SCHEDULED', 't2', 'b2')
    seedAppointment(ctx, 999, '10:00', '11:00', 'SCHEDULED', 't1', 'other-business')

    await expect(createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))).resolves.toBeDefined()
    expect(await getIntervalCapacity(ctx, local(ctx, '10:00'), local(ctx, '11:00'))).toMatchObject({ occupied: 1, remaining: 0 })
  })

  it("this tenant's bookings never reduce another tenant's availability", async () => {
    const ctx = contextFor(1)
    await createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))
    const foreign = foreignCtx()

    const result = await checkIntervalAvailability(foreign, { serviceId: FOREIGN_SERVICE, startAt: local(ctx, '10:00') })
    expect(result).toMatchObject({ available: true, capacity: { capacity: 1, occupied: 0, remaining: 1 } })
  })
})

describe('concurrency — the last free post', () => {
  it('capacity 1: 10 simultaneous bookings of different vehicles → exactly 1 succeeds, 9 get CAPACITY_EXCEEDED, no 500', async () => {
    const ctx = contextFor(1)

    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createAppointment(ctx, input(ctx, i + 1, '10:00', '11:00'))))

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(9)
    for (const r of rejected) expect(r.reason).toMatchObject({ statusCode: 409, code: 'CAPACITY_EXCEEDED' })
    expect(activeIn(ctx, '10:00', '11:00')).toBe(1)
  })

  it('capacity 3: four simultaneous bookings → 3 succeed, the 4th is refused; a 5th later is refused too', async () => {
    const ctx = contextFor(3)

    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => createAppointment(ctx, input(ctx, i + 1, '14:00', '15:00'))))

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 5, '14:30', '15:30')))
    expect(activeIn(ctx, '14:00', '15:00')).toBe(3)
  })

  it('a failed insert rolls back and releases the post: the retry succeeds, nothing half-written', async () => {
    const ctx = contextFor(1)
    fail.create = true

    await expect(createAppointment(ctx, input(ctx, 1, '10:00', '11:00'))).rejects.toThrow('insert failed')
    expect(db.appointments).toHaveLength(0)
    await expect(createAppointment(ctx, input(ctx, 2, '10:00', '11:00'))).resolves.toBeDefined()
    expect(db.appointments).toHaveLength(1)
  })

  it('capacity is read under the lock, not from the request context (a capacity lowered meanwhile wins)', async () => {
    const ctx = contextFor(2) // request started when capacity was 2
    seedAppointment(ctx, 1, '10:00', '11:00')
    db.businesses.find((b) => b.id === 'b1')!.serviceBayCapacity = 1 // admin lowered it since

    await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '10:00', '11:00')))
  })
})

describe('availability agrees with create', () => {
  it('for a grid of intervals, checkIntervalAvailability.available === create would succeed', async () => {
    const ctx = contextFor(2)
    seedAppointment(ctx, 1, '10:00', '11:00')
    seedAppointment(ctx, 2, '10:30', '11:30')
    seedAppointment(ctx, 3, '13:00', '14:00')
    seedAppointment(ctx, 4, '13:00', '14:00', 'CANCELLED')

    for (const [from, to] of [
      ['09:00', '10:00'], ['09:30', '10:30'], ['10:00', '11:00'], ['11:00', '12:00'], ['11:15', '12:15'],
      ['12:30', '13:30'], ['13:00', '14:00'], ['17:00', '18:00'], ['17:30', '18:30'], ['08:30', '09:30'],
    ] as const) {
      const verdict = await checkIntervalAvailability(ctx, { serviceId: SERVICE, startAt: local(ctx, from), endAt: local(ctx, to), vehicleId: vehicle(10) })
      const created = await createAppointment(ctx, input(ctx, 10, from, to)).then(
        (row) => {
          db.appointments = db.appointments.filter((r) => r.id !== row.id) // undo, keep the grid independent
          return true
        },
        () => false
      )
      expect({ from, to, available: verdict.available }).toEqual({ from, to, available: created })
    }
  })

  it('reports every failing rule with Russian messages, and the capacity numbers', async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '17:00', '18:00')

    const result = await checkIntervalAvailability(ctx, { serviceId: SERVICE, startAt: local(ctx, '17:30'), vehicleId: vehicle(1) })

    expect(result.endAt).toEqual(local(ctx, '18:30')) // startAt + 60 min service duration
    expect(result.available).toBe(false)
    expect(result.reasons.map((r) => r.code)).toEqual(['OUTSIDE_WORKING_HOURS', 'VEHICLE_CONFLICT', 'CAPACITY_EXCEEDED'])
    expect(result.reasons.find((r) => r.code === 'CAPACITY_EXCEEDED')!.message).toBe(CAPACITY_MESSAGE)
    expect(result.capacity).toEqual({ capacity: 1, occupied: 1, remaining: 0, available: false })
  })

  it('the slot generator (AI check_availability) never offers a slot without a free post', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    try {
      const ctx = contextFor(1)
      seedAppointment(ctx, 1, '10:00', '11:00')

      const { slots } = await checkAvailability(ctx, { serviceId: SERVICE, date: DAY })
      const starts = slots.map((s) => s.localStart)
      expect(starts).toContain('09:00') // 09:00–10:00 is adjacent → free
      expect(starts).not.toContain('09:30')
      expect(starts).not.toContain('10:00')
      expect(starts).not.toContain('10:30')
      expect(starts).toContain('11:00')
      for (const slot of slots) {
        const verdict = await checkIntervalAvailability(ctx, { serviceId: SERVICE, startAt: slot.startAt })
        expect(verdict.available).toBe(true)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('timezone — the business timezone is authoritative', () => {
  it('UTC+12 (Asia/Kamchatka): a Monday-morning booking stored on Sunday in UTC is counted for the local Monday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    try {
      const ctx = contextFor(1, 'Asia/Kamchatka')
      await createAppointment(ctx, input(ctx, 1, '09:00', '10:00'))
      expect(db.appointments[0]!.startAt.toISOString()).toBe('2026-10-04T21:00:00.000Z') // Sunday in UTC

      await expectCapacityExceeded(createAppointment(ctx, input(ctx, 2, '09:30', '10:30')))
      const { slots } = await checkAvailability(ctx, { serviceId: SERVICE, date: DAY })
      expect(slots.map((s) => s.localStart)).not.toContain('09:00')
      expect(slots[0]!.localStart).toBe('10:00')
    } finally {
      vi.useRealTimers()
    }
  })

  it('DST zone (America/New_York, EDT UTC−4): 09:00 local is 13:00 UTC, and capacity is judged on local hours', async () => {
    const ctx = contextFor(1, 'America/New_York')
    const created = await createAppointment(ctx, input(ctx, 1, '09:00', '10:00'))
    expect(created.startAt.toISOString()).toBe('2026-10-05T13:00:00.000Z')

    const sameUtcHourAsLocalNine = await checkIntervalAvailability(ctx, { serviceId: SERVICE, startAt: new Date('2026-10-05T09:00:00Z') })
    expect(sameUtcHourAsLocalNine.reasons.map((r) => r.code)).toEqual(['OUTSIDE_WORKING_HOURS']) // 05:00 local — closed, but the post is free
  })
})

// ---------------------------------------------------------------------------
// GET /api/appointments/availability
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
async function getAvailability(query: Record<string, string>, method = 'GET') {
  const res = makeRes()
  await availabilityHandler({ method, headers: {}, query, body: undefined } as unknown as ApiRequest, res)
  return res
}

describe('GET /api/appointments/availability', () => {
  it('answers for the session business, with capacity numbers', async () => {
    const ctx = contextFor(2)
    auth.ctx = ctx
    seedAppointment(ctx, 1, '10:00', '11:00')

    const res = await getAvailability({ serviceId: SERVICE, startAt: local(ctx, '10:00').toISOString() })

    expect(res.statusCode).toBe(200)
    expect(res.body.availability).toMatchObject({ available: true, timezone: 'Europe/Moscow', capacity: { capacity: 2, occupied: 1, remaining: 1 } })
  })

  it('is tenant-scoped: another tenant sees only its own occupancy, and foreign service/vehicle ids are 404', async () => {
    const ctx = contextFor(1)
    seedAppointment(ctx, 1, '10:00', '11:00')
    auth.ctx = foreignCtx()
    const startAt = local(ctx, '10:00').toISOString()

    const own = await getAvailability({ serviceId: FOREIGN_SERVICE, startAt })
    expect(own.body.availability).toMatchObject({ available: true, capacity: { occupied: 0 } })
    expect((await getAvailability({ serviceId: SERVICE, startAt })).statusCode).toBe(404)
    expect((await getAvailability({ serviceId: FOREIGN_SERVICE, startAt, vehicleId: vehicle(1) })).statusCode).toBe(404)
  })

  it('validates the query (400) and refuses other methods (405)', async () => {
    auth.ctx = contextFor(1)
    expect((await getAvailability({ serviceId: 'nope', startAt: '2026-10-05T07:00:00Z' })).statusCode).toBe(400)
    expect((await getAvailability({ serviceId: SERVICE, startAt: '5 октября' })).statusCode).toBe(400)
    expect((await getAvailability({ serviceId: SERVICE, startAt: '2026-10-05T07:00:00Z' }, 'POST')).statusCode).toBe(405)
  })
})
