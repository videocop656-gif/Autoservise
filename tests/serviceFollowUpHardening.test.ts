import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeTenant, makeBusiness } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Prompt 48.1 — hardening of the Service Follow-up / Retention Loop:
// atomicity (ServiceRecord + follow-up), concurrency ("Создать обращение"),
// the BOOKED invariant and archive → DISMISSED.
//
// The repositories are backed by a small in-memory store and
// runInTransaction is replaced by a faithful model of a database
// transaction:
//   - it snapshots the store and RESTORES it if the callback throws, so a
//     test can observe a real rollback of everything written through `tx`;
//   - transactions run one at a time, which is what PostgreSQL's
//     SELECT … FOR UPDATE row lock guarantees for concurrent calls on the
//     same follow-up (the real lock query itself is covered in
//     tenantIsolation.test.ts and was exercised against a real PostgreSQL —
//     see final-report-48-1.md).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string; tenantId: string; businessId: string }

const { db, fail, TX } = vi.hoisted(() => {
  const db = {
    serviceRecords: [] as Row[],
    followUps: [] as Row[],
    requests: [] as Row[],
    appointments: [] as Row[],
    customers: [] as Row[],
    vehicles: [] as Row[],
    services: [] as Row[],
  }
  // Failure injection: the next call of the named operation throws.
  const fail = { followUpCreate: false, followUpUpdate: false, requestCreate: false }
  const TX = { __tx: true } as Record<string, unknown>
  return { db, fail, TX }
})

let seq = 0
const newId = (p: string) => `${p}-${++seq}`
const scoped = (rows: Row[], t: string, b: string) => rows.filter((r) => r.tenantId === t && r.businessId === b)
const clone = <T>(v: T): T => structuredClone(v)

let chain: Promise<unknown> = Promise.resolve()
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
    const run = async () => {
      const snapshot = clone(db)
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

vi.mock('../src/server/repositories/serviceRecordRepository', () => ({
  serviceRecordRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.serviceRecords, t, b).find((r) => r.id === id) ?? null,
    findMaxActiveMileage: async () => null,
    create: async (data: Row) => {
      const row = { ...data, id: newId('rec'), isArchived: false }
      db.serviceRecords.push(row)
      return row
    },
    updateById: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      const row = scoped(db.serviceRecords, t, b).find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
  },
}))

vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({
  serviceFollowUpRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.followUps, t, b).find((r) => r.id === id) ?? null,
    findByIdForUpdate: async (t: string, b: string, id: string) => {
      const row = scoped(db.followUps, t, b).find((r) => r.id === id)
      return row ? { ...row } : null
    },
    findByServiceRecordId: async (t: string, b: string, serviceRecordId: string) =>
      scoped(db.followUps, t, b).find((r) => r.serviceRecordId === serviceRecordId) ?? null,
    create: async (data: Row) => {
      if (fail.followUpCreate) {
        fail.followUpCreate = false
        throw new Error('follow-up insert failed')
      }
      if (db.followUps.some((f) => f.serviceRecordId && f.serviceRecordId === data.serviceRecordId)) {
        throw new Error('unique violation: serviceRecordId')
      }
      const row = { note: null, customerRequestId: null, ...data, id: newId('fu') }
      db.followUps.push(row)
      return row
    },
    updateById: async (t: string, b: string, id: string, data: Record<string, unknown>) => {
      if (fail.followUpUpdate) {
        fail.followUpUpdate = false
        throw new Error('follow-up update failed')
      }
      const row = scoped(db.followUps, t, b).find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return { ...row }
    },
    markBookedByCustomerRequest: async (t: string, b: string, customerRequestId: string) => {
      const rows = scoped(db.followUps, t, b).filter(
        (r) => r.customerRequestId === customerRequestId && (r.status === 'PENDING' || r.status === 'CONTACTED')
      )
      rows.forEach((r) => (r.status = 'BOOKED'))
      return rows.length
    },
    list: async () => ({ items: [], total: 0 }),
  },
}))

vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: async (t: string, b: string, id: string) => scoped(db.requests, t, b).find((r) => r.id === id) ?? null,
    createWithInitialHistory: async (data: Row) => {
      // Yield once, so concurrent callers genuinely interleave here if they
      // were not serialized by the transaction/lock.
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (fail.requestCreate) {
        fail.requestCreate = false
        throw new Error('request insert failed')
      }
      const row = { ...data, id: newId('req') }
      db.requests.push(row)
      return row
    },
    updateById: async () => null,
    updateWithStatusHistory: async () => null,
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
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { findById: async (t: string, b: string, id: string) => scoped(db.appointments, t, b).find((r) => r.id === id) ?? null },
}))

import { createServiceRecord, updateServiceRecord } from '../src/server/services/serviceRecordService'
import { createCustomerRequestFromFollowUp, updateServiceFollowUp } from '../src/server/services/serviceFollowUpService'
import { ApiError } from '../src/server/lib/errors'

// loadLinkedRequest reads through the transaction client.
TX.customerRequest = {
  findFirst: async ({ where }: { where: { tenantId: string; businessId: string; id: string } }) =>
    scoped(db.requests, where.tenantId, where.businessId).find((r) => r.id === where.id) ?? null,
}

const ctx = makeAuthContext('manager') // tenant t1 / business b1, Europe/Moscow
const foreignCtx = makeAuthContext('owner', {
  tenant: makeTenant({ id: 't2' }),
  business: makeBusiness({ id: 'b2', tenantId: 't2' }),
})

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222'
const SERVICE_ID = '33333333-3333-4333-8333-333333333333'

function seed() {
  for (const key of Object.keys(db) as Array<keyof typeof db>) db[key] = []
  Object.assign(fail, { followUpCreate: false, followUpUpdate: false, requestCreate: false })
  const own = { tenantId: 't1', businessId: 'b1' }
  db.customers.push({ ...own, id: CUSTOMER_ID, isActive: true })
  db.vehicles.push({ ...own, id: VEHICLE_ID, customerId: CUSTOMER_ID, isActive: true })
  db.services.push({ ...own, id: SERVICE_ID, name: 'Замена масла', isActive: true, repeatIntervalDays: 180 })
}

function recordInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    performedAt: new Date('2026-09-29T10:00:00.000Z'),
    totalPrice: 4500,
    workDescription: 'Замена масла',
    ...overrides,
  }
}

function addFollowUp(overrides: Record<string, unknown> = {}): Row {
  const row: Row = {
    id: newId('fu'),
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    serviceRecordId: null,
    dueAt: new Date('2026-10-01T21:00:00.000Z'),
    status: 'PENDING',
    customerRequestId: null,
    note: null,
    ...overrides,
  }
  db.followUps.push(row)
  return row
}

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).statusCode).toBe(status)
  if (code) expect((err as ApiError).code).toBe(code)
}

beforeEach(() => {
  seq = 0
  seed()
})

describe('atomicity — ServiceRecord + ServiceFollowUp commit or roll back together', () => {
  it('create + follow-up success → both exist', async () => {
    const record = await createServiceRecord(ctx, recordInput())

    expect(db.serviceRecords).toHaveLength(1)
    expect(db.followUps).toHaveLength(1)
    expect(db.followUps[0]).toMatchObject({ serviceRecordId: record.id, status: 'PENDING' })
  })

  it('follow-up insert fails → the ServiceRecord insert is rolled back too, and the error reaches the caller', async () => {
    fail.followUpCreate = true

    await expect(createServiceRecord(ctx, recordInput())).rejects.toThrow('follow-up insert failed')
    expect(db.serviceRecords).toHaveLength(0)
    expect(db.followUps).toHaveLength(0)
  })

  it('update + follow-up update → both commit', async () => {
    const record = await createServiceRecord(ctx, recordInput())

    await updateServiceRecord(ctx, record.id, { notes: 'уточнено', followUpDueDate: '2027-01-15' })

    expect(db.serviceRecords[0]!.notes).toBe('уточнено')
    expect(db.followUps[0]!.dueAt).toEqual(new Date('2027-01-14T21:00:00.000Z'))
  })

  it('follow-up update fails → the ServiceRecord update is rolled back', async () => {
    const record = await createServiceRecord(ctx, recordInput({ notes: 'исходно' }))
    const dueBefore = db.followUps[0]!.dueAt
    fail.followUpUpdate = true

    await expect(updateServiceRecord(ctx, record.id, { notes: 'новое', followUpDueDate: '2027-01-15' })).rejects.toThrow(
      'follow-up update failed'
    )
    expect(db.serviceRecords[0]!.notes).toBe('исходно')
    expect(db.followUps[0]!.dueAt).toEqual(dueBefore)
  })

  it('a record without interval and without date commits alone (Case C unchanged)', async () => {
    db.services[0]!.repeatIntervalDays = null

    await createServiceRecord(ctx, recordInput())

    expect(db.serviceRecords).toHaveLength(1)
    expect(db.followUps).toHaveLength(0)
  })
})

describe('archive — a PENDING follow-up of an archived ServiceRecord becomes DISMISSED', () => {
  it('PENDING → DISMISSED, in the same save that archives the record', async () => {
    const record = await createServiceRecord(ctx, recordInput())

    await updateServiceRecord(ctx, record.id, { isArchived: true })

    expect(db.serviceRecords[0]!.isArchived).toBe(true)
    expect(db.followUps[0]!.status).toBe('DISMISSED')
  })

  it.each(['CONTACTED', 'BOOKED', 'DISMISSED'])('%s is left unchanged — history is never rewritten', async (status) => {
    const record = await createServiceRecord(ctx, recordInput())
    db.followUps[0]!.status = status

    await updateServiceRecord(ctx, record.id, { isArchived: true })

    expect(db.serviceRecords[0]!.isArchived).toBe(true)
    expect(db.followUps[0]!.status).toBe(status)
  })

  it('archive wins over a date sent in the same request', async () => {
    const record = await createServiceRecord(ctx, recordInput())

    await updateServiceRecord(ctx, record.id, { isArchived: true, followUpDueDate: '2027-05-01' })

    expect(db.followUps).toHaveLength(1)
    expect(db.followUps[0]!.status).toBe('DISMISSED')
  })

  it('dismissing fails → archiving is rolled back as well', async () => {
    const record = await createServiceRecord(ctx, recordInput())
    fail.followUpUpdate = true

    await expect(updateServiceRecord(ctx, record.id, { isArchived: true })).rejects.toThrow('follow-up update failed')
    expect(db.serviceRecords[0]!.isArchived).toBe(false)
    expect(db.followUps[0]!.status).toBe('PENDING')
  })

  it('restoring the record does not resurrect the dismissed follow-up', async () => {
    const record = await createServiceRecord(ctx, recordInput())
    await updateServiceRecord(ctx, record.id, { isArchived: true })

    await updateServiceRecord(ctx, record.id, { isArchived: false })

    expect(db.followUps).toHaveLength(1)
    expect(db.followUps[0]!.status).toBe('DISMISSED')
  })

  it('a record that was already archived does not dismiss anything on a plain edit', async () => {
    const record = await createServiceRecord(ctx, recordInput())
    db.serviceRecords[0]!.isArchived = true // archived before this prompt, follow-up still PENDING

    await updateServiceRecord(ctx, record.id, { notes: 'правка' })

    expect(db.followUps[0]!.status).toBe('PENDING')
  })
})

describe('concurrency — "Создать обращение" creates at most one CustomerRequest', () => {
  it('10 concurrent calls → exactly one request, one link, CONTACTED, every response points to it, no orphans', async () => {
    const followUp = addFollowUp()

    const results = await Promise.all(Array.from({ length: 10 }, () => createCustomerRequestFromFollowUp(ctx, followUp.id)))

    expect(db.requests).toHaveLength(1)
    const [request] = db.requests
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => r.request.id))).toEqual(new Set([request!.id]))
    expect(db.followUps[0]).toMatchObject({ status: 'CONTACTED', customerRequestId: request!.id })
    // No orphan: every request in the store is linked from the follow-up.
    expect(db.requests.every((r) => r.id === db.followUps[0]!.customerRequestId)).toBe(true)
  })

  it('a sequential repeat returns the same request', async () => {
    const followUp = addFollowUp()

    const first = await createCustomerRequestFromFollowUp(ctx, followUp.id)
    const second = await createCustomerRequestFromFollowUp(ctx, followUp.id)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.request.id).toBe(first.request.id)
    expect(db.requests).toHaveLength(1)
  })

  it('linking fails after the request was inserted → the request is rolled back (no orphan) and the follow-up stays PENDING', async () => {
    const followUp = addFollowUp()
    fail.followUpUpdate = true

    await expect(createCustomerRequestFromFollowUp(ctx, followUp.id)).rejects.toThrow('follow-up update failed')
    expect(db.requests).toHaveLength(0)
    expect(db.followUps[0]).toMatchObject({ status: 'PENDING', customerRequestId: null })

    // …and a retry then succeeds normally.
    const retry = await createCustomerRequestFromFollowUp(ctx, followUp.id)
    expect(retry.created).toBe(true)
    expect(db.requests).toHaveLength(1)
  })

  it('a failed request insert leaves nothing behind', async () => {
    const followUp = addFollowUp()
    fail.requestCreate = true

    await expect(createCustomerRequestFromFollowUp(ctx, followUp.id)).rejects.toThrow('request insert failed')
    expect(db.requests).toHaveLength(0)
    expect(db.followUps[0]!.status).toBe('PENDING')
  })
})

describe('BOOKED invariant — never without a real appointment', () => {
  function addConvertedRequest(overrides: Record<string, unknown> = {}): Row {
    const row: Row = { id: newId('req'), tenantId: 't1', businessId: 'b1', status: 'CONVERTED', appointmentId: 'appt-1', ...overrides }
    db.requests.push(row)
    return row
  }

  it('PENDING → BOOKED without any request → 400 FOLLOW_UP_NOT_BOOKED, nothing changes', async () => {
    const followUp = addFollowUp()

    await expectApiError(updateServiceFollowUp(ctx, followUp.id, { status: 'BOOKED' }), 400, 'FOLLOW_UP_NOT_BOOKED')
    expect(db.followUps[0]!.status).toBe('PENDING')
  })

  it('CONTACTED → BOOKED while the request is not CONVERTED → 400', async () => {
    const request = addConvertedRequest({ status: 'IN_PROGRESS', appointmentId: null })
    const followUp = addFollowUp({ status: 'CONTACTED', customerRequestId: request.id })

    await expectApiError(updateServiceFollowUp(ctx, followUp.id, { status: 'BOOKED' }), 400, 'FOLLOW_UP_NOT_BOOKED')
    expect(db.followUps[0]!.status).toBe('CONTACTED')
  })

  it('CONTACTED → BOOKED when the request points to an appointment that does not exist → 400', async () => {
    const request = addConvertedRequest({ appointmentId: 'missing-appointment' })
    const followUp = addFollowUp({ status: 'CONTACTED', customerRequestId: request.id })

    await expectApiError(updateServiceFollowUp(ctx, followUp.id, { status: 'BOOKED' }), 400, 'FOLLOW_UP_NOT_BOOKED')
  })

  it('CONTACTED → BOOKED with a CONVERTED request and an existing appointment → allowed', async () => {
    db.appointments.push({ id: 'appt-1', tenantId: 't1', businessId: 'b1', status: 'SCHEDULED' })
    const request = addConvertedRequest()
    const followUp = addFollowUp({ status: 'CONTACTED', customerRequestId: request.id })

    const updated = await updateServiceFollowUp(ctx, followUp.id, { status: 'BOOKED' })

    expect(updated.status).toBe('BOOKED')
  })

  it('an appointment of another tenant does not count', async () => {
    db.appointments.push({ id: 'appt-1', tenantId: 't2', businessId: 'b2', status: 'SCHEDULED' })
    const request = addConvertedRequest()
    const followUp = addFollowUp({ status: 'CONTACTED', customerRequestId: request.id })

    await expectApiError(updateServiceFollowUp(ctx, followUp.id, { status: 'BOOKED' }), 400, 'FOLLOW_UP_NOT_BOOKED')
  })

  it('terminal protections remain: BOOKED → anything and DISMISSED → BOOKED are still rejected by the matrix', async () => {
    const booked = addFollowUp({ status: 'BOOKED' })
    const dismissed = addFollowUp({ status: 'DISMISSED' })

    await expectApiError(updateServiceFollowUp(ctx, booked.id, { status: 'DISMISSED' }), 400, 'INVALID_STATUS_TRANSITION')
    await expectApiError(updateServiceFollowUp(ctx, dismissed.id, { status: 'BOOKED' }), 400, 'INVALID_STATUS_TRANSITION')
  })
})

describe('tenant isolation of the hardened paths', () => {
  it('POST request on a foreign follow-up → 404, no request created, nothing locked or changed', async () => {
    const followUp = addFollowUp()

    await expectApiError(createCustomerRequestFromFollowUp(foreignCtx, followUp.id), 404, 'NOT_FOUND')
    expect(db.requests).toHaveLength(0)
    expect(db.followUps[0]!.status).toBe('PENDING')
  })

  it('PATCH BOOKED on a foreign follow-up → 404 (existence not revealed, no booking check leaks)', async () => {
    const followUp = addFollowUp()

    await expectApiError(updateServiceFollowUp(foreignCtx, followUp.id, { status: 'BOOKED' }), 404, 'NOT_FOUND')
  })

  it('archiving a foreign ServiceRecord → 404, its follow-up untouched', async () => {
    const record = await createServiceRecord(ctx, recordInput())

    await expectApiError(updateServiceRecord(foreignCtx, record.id, { isArchived: true }), 404, 'NOT_FOUND')
    expect(db.serviceRecords[0]!.isArchived).toBe(false)
    expect(db.followUps[0]!.status).toBe('PENDING')
  })
})
