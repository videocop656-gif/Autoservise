import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'

// ---------------------------------------------------------------------------
// Prompt 48 — Service Follow-up / Retention Loop: domain rules.
// Repositories are mocked (same convention as serviceRecordService.test.ts);
// the real serviceRecordService / customerRequestService / serviceFollowUp
// service code runs on top of them, so creation, idempotency, transitions
// and the request hand-off are exercised end to end in the domain layer.
// The business timezone is Europe/Moscow (UTC+3, no DST) unless a test
// overrides it.
// ---------------------------------------------------------------------------

const {
  fuFindByIdMock,
  fuFindByServiceRecordIdMock,
  fuCreateMock,
  fuUpdateByIdMock,
  fuFindByIdForUpdateMock,
  txCustomerRequestFindFirstMock,
  fuMarkBookedMock,
  fuListMock,
  srCreateMock,
  srFindByIdMock,
  srUpdateByIdMock,
  srFindMaxActiveMileageMock,
  crFindByIdMock,
  crCreateWithInitialHistoryMock,
  crUpdateWithStatusHistoryMock,
  crUpdateByIdMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  serviceFindByIdMock,
  appointmentFindByIdMock,
} = vi.hoisted(() => ({
  fuFindByIdMock: vi.fn(),
  fuFindByServiceRecordIdMock: vi.fn(),
  fuCreateMock: vi.fn(),
  fuUpdateByIdMock: vi.fn(),
  fuFindByIdForUpdateMock: vi.fn(),
  txCustomerRequestFindFirstMock: vi.fn(),
  fuMarkBookedMock: vi.fn(),
  fuListMock: vi.fn(),
  srCreateMock: vi.fn(),
  srFindByIdMock: vi.fn(),
  srUpdateByIdMock: vi.fn(),
  srFindMaxActiveMileageMock: vi.fn(),
  crFindByIdMock: vi.fn(),
  crCreateWithInitialHistoryMock: vi.fn(),
  crUpdateWithStatusHistoryMock: vi.fn(),
  crUpdateByIdMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  serviceFindByIdMock: vi.fn(),
  appointmentFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/serviceFollowUpRepository', () => ({
  serviceFollowUpRepository: {
    list: fuListMock,
    findById: fuFindByIdMock,
    findByServiceRecordId: fuFindByServiceRecordIdMock,
    create: fuCreateMock,
    updateById: fuUpdateByIdMock,
    findByIdForUpdate: fuFindByIdForUpdateMock,
    markBookedByCustomerRequest: fuMarkBookedMock,
  },
}))
// Prompt 48.1 — writes run inside runInTransaction. Here it is a
// pass-through with a recognisable TX client (so tests can assert every
// write joins the transaction); real rollback/locking semantics are covered
// in serviceFollowUpHardening.test.ts.
const TX = { __tx: true, customerRequest: { findFirst: (...args: unknown[]) => txCustomerRequestFindFirstMock(...args) } }
vi.mock('../src/server/db/transaction', () => ({
  runInTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
}))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({
  serviceRecordRepository: {
    create: srCreateMock,
    findById: srFindByIdMock,
    updateById: srUpdateByIdMock,
    findMaxActiveMileage: srFindMaxActiveMileageMock,
  },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    findById: crFindByIdMock,
    createWithInitialHistory: crCreateWithInitialHistoryMock,
    updateWithStatusHistory: crUpdateWithStatusHistoryMock,
    updateById: crUpdateByIdMock,
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: customerFindByIdMock },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: { findById: vehicleFindByIdMock },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: { findById: serviceFindByIdMock },
}))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { findById: appointmentFindByIdMock },
}))

import {
  addDaysToDateKey,
  assertValidFollowUpTransition,
  createCustomerRequestFromFollowUp,
  followUpDueAtFromDateKey,
  followUpDueAtFromInterval,
  updateServiceFollowUp,
} from '../src/server/services/serviceFollowUpService'
import { createServiceRecord, updateServiceRecord } from '../src/server/services/serviceRecordService'
import { updateCustomerRequest } from '../src/server/services/customerRequestService'
import { ApiError } from '../src/server/lib/errors'

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222'
const SERVICE_ID = '33333333-3333-4333-8333-333333333333'
const RECORD_ID = '44444444-4444-4444-8444-444444444444'
const FOLLOW_UP_ID = '55555555-5555-4555-8555-555555555555'
const REQUEST_ID = '66666666-6666-4666-8666-666666666666'
const APPOINTMENT_ID = '77777777-7777-4777-8777-777777777777'

type Status = 'PENDING' | 'CONTACTED' | 'BOOKED' | 'DISMISSED'

function makeService(overrides: Record<string, unknown> = {}) {
  return { id: SERVICE_ID, tenantId: 't1', businessId: 'b1', name: 'Замена масла', isActive: true, repeatIntervalDays: null, ...overrides }
}
function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    appointmentId: null,
    // 2026-09-29 13:00 in Moscow.
    performedAt: new Date('2026-09-29T10:00:00.000Z'),
    mileage: null,
    isArchived: false,
    ...overrides,
  }
}
function makeFollowUp(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLLOW_UP_ID,
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID as string | null,
    serviceRecordId: RECORD_ID as string | null,
    dueAt: new Date('2027-03-27T21:00:00.000Z'),
    status: 'PENDING' as Status,
    customerRequestId: null as string | null,
    note: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    performedAt: new Date('2026-09-29T10:00:00.000Z'),
    totalPrice: 5000,
    workDescription: 'Замена масла и фильтра',
    ...overrides,
  }
}

async function expectApiError(promise: Promise<unknown>, status: number, code?: string) {
  const err = await promise.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).statusCode).toBe(status)
  if (code) expect((err as ApiError).code).toBe(code)
}

const ctx = makeAuthContext('manager')

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue({ id: CUSTOMER_ID, tenantId: 't1', businessId: 'b1', isActive: true })
  vehicleFindByIdMock.mockResolvedValue({ id: VEHICLE_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, isActive: true })
  serviceFindByIdMock.mockResolvedValue(makeService())
  appointmentFindByIdMock.mockResolvedValue(null)
  srFindMaxActiveMileageMock.mockResolvedValue(null)
  srCreateMock.mockImplementation(async (data: Record<string, unknown>) => ({ ...makeRecord(), ...data, id: RECORD_ID }))
  srFindByIdMock.mockResolvedValue(makeRecord())
  srUpdateByIdMock.mockImplementation(async (_t: string, _b: string, _id: string, data: Record<string, unknown>) => ({ ...makeRecord(), ...data }))
  fuFindByServiceRecordIdMock.mockResolvedValue(null)
  fuCreateMock.mockImplementation(async (data: Record<string, unknown>) => ({ ...makeFollowUp(), ...data }))
  fuUpdateByIdMock.mockImplementation(async (_t: string, _b: string, _id: string, data: Record<string, unknown>) => ({ ...makeFollowUp(), ...data }))
  fuFindByIdMock.mockResolvedValue(makeFollowUp())
  fuFindByIdForUpdateMock.mockResolvedValue(makeFollowUp())
  txCustomerRequestFindFirstMock.mockResolvedValue({ id: REQUEST_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, status: 'NEW' })
  fuMarkBookedMock.mockResolvedValue(1)
  crCreateWithInitialHistoryMock.mockImplementation(async (data: Record<string, unknown>) => ({ id: REQUEST_ID, ...data }))
  crFindByIdMock.mockResolvedValue({ id: REQUEST_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, status: 'NEW' })
})

describe('follow-up creation from a ServiceRecord', () => {
  it('Case B — the service repeat interval creates a PENDING follow-up at performedAt + 180 days (Business-local)', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 180 }))

    await createServiceRecord(ctx, createInput())

    expect(fuCreateMock).toHaveBeenCalledTimes(1)
    // 2026-09-29 (Moscow) + 180 days = 2027-03-28; its Moscow midnight is 2027-03-27T21:00Z.
    expect(fuCreateMock).toHaveBeenCalledWith({
      tenantId: 't1',
      businessId: 'b1',
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      serviceRecordId: RECORD_ID,
      dueAt: new Date('2027-03-27T21:00:00.000Z'),
      status: 'PENDING',
    }, TX)
  })

  it('Case A — a manual date overrides the service interval', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 180 }))

    await createServiceRecord(ctx, createInput({ followUpDueDate: '2026-12-01' }))

    expect(fuCreateMock).toHaveBeenCalledTimes(1)
    expect(fuCreateMock.mock.calls[0]![0].dueAt).toEqual(new Date('2026-11-30T21:00:00.000Z'))
  })

  it('Case A — a manual date works for a service without any interval', async () => {
    await createServiceRecord(ctx, createInput({ followUpDueDate: '2026-12-01' }))

    expect(fuCreateMock).toHaveBeenCalledTimes(1)
  })

  it('Case C — no manual date and no interval creates no follow-up', async () => {
    await createServiceRecord(ctx, createInput())

    expect(fuCreateMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })

  it('an explicitly cleared date (null) creates no follow-up even when the service has an interval', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 180 }))

    await createServiceRecord(ctx, createInput({ followUpDueDate: null }))

    expect(fuCreateMock).not.toHaveBeenCalled()
  })

  it('a historical ServiceRecord without an Appointment gets a follow-up too', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 30 }))

    const record = await createServiceRecord(ctx, createInput({ appointmentId: null }))

    expect(record.appointmentId).toBeNull()
    expect(appointmentFindByIdMock).not.toHaveBeenCalled()
    expect(fuCreateMock).toHaveBeenCalledTimes(1)
    expect(fuCreateMock.mock.calls[0]![0].serviceRecordId).toBe(RECORD_ID)
  })

  it('the follow-up is only created after the ServiceRecord itself was saved', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 30 }))
    srCreateMock.mockRejectedValue(new Error('db down'))

    await expect(createServiceRecord(ctx, createInput())).rejects.toThrow('db down')
    expect(fuCreateMock).not.toHaveBeenCalled()
  })

  it('a rejected ServiceRecord (e.g. CANCELLED appointment) creates no follow-up — existing protection intact', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 30 }))
    appointmentFindByIdMock.mockResolvedValue({
      id: APPOINTMENT_ID,
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      status: 'CANCELLED',
    })

    await expectApiError(createServiceRecord(ctx, createInput({ appointmentId: APPOINTMENT_ID })), 400)
    expect(srCreateMock).not.toHaveBeenCalled()
    expect(fuCreateMock).not.toHaveBeenCalled()
  })
})

describe('idempotency when a ServiceRecord is saved again', () => {
  it('never creates a duplicate PENDING — the existing PENDING is updated in place', async () => {
    fuFindByServiceRecordIdMock.mockResolvedValue(makeFollowUp({ status: 'PENDING' }))

    await updateServiceRecord(ctx, RECORD_ID, { followUpDueDate: '2027-01-15' })

    expect(fuCreateMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).toHaveBeenCalledTimes(1)
    expect(fuUpdateByIdMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, {
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      dueAt: new Date('2027-01-14T21:00:00.000Z'),
    }, TX)
  })

  it('never passes followUpDueDate through to the ServiceRecord row itself', async () => {
    await updateServiceRecord(ctx, RECORD_ID, { notes: 'x', followUpDueDate: '2027-01-15' })

    expect(srUpdateByIdMock.mock.calls[0]![3]).toEqual({ notes: 'x' })
  })

  it('an edit without the field leaves the follow-up untouched and never applies the interval', async () => {
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 180 }))

    await updateServiceRecord(ctx, RECORD_ID, { notes: 'edited' })

    expect(fuCreateMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })

  it.each(['CONTACTED', 'BOOKED', 'DISMISSED'] as const)(
    'a %s follow-up is never replaced or re-created automatically',
    async (status) => {
      fuFindByServiceRecordIdMock.mockResolvedValue(makeFollowUp({ status }))

      await updateServiceRecord(ctx, RECORD_ID, { followUpDueDate: '2027-01-15' })

      expect(fuCreateMock).not.toHaveBeenCalled()
      expect(fuUpdateByIdMock).not.toHaveBeenCalled()
    }
  )

  it('clearing the date on edit dismisses the PENDING follow-up (no hidden extra follow-ups)', async () => {
    fuFindByServiceRecordIdMock.mockResolvedValue(makeFollowUp({ status: 'PENDING' }))

    await updateServiceRecord(ctx, RECORD_ID, { followUpDueDate: null })

    expect(fuCreateMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, { status: 'DISMISSED' }, TX)
  })

  it('an edit that sets a date on a record that never had a follow-up creates exactly one', async () => {
    await updateServiceRecord(ctx, RECORD_ID, { followUpDueDate: '2027-01-15' })

    expect(fuCreateMock).toHaveBeenCalledTimes(1)
  })
})

describe('status transition matrix', () => {
  // Prompt 48.1 — the matrix itself is unchanged (spec §6), but reaching
  // BOOKED through PATCH additionally requires a real appointment (see the
  // BOOKED describe below), so these are the transitions a plain PATCH can do.
  const allowed: Array<[Status, Status]> = [
    ['PENDING', 'CONTACTED'],
    ['PENDING', 'DISMISSED'],
    ['CONTACTED', 'DISMISSED'],
  ]
  const forbidden: Array<[Status, Status]> = [
    ['CONTACTED', 'PENDING'],
    ['BOOKED', 'PENDING'],
    ['BOOKED', 'CONTACTED'],
    ['BOOKED', 'DISMISSED'],
    ['DISMISSED', 'PENDING'],
    ['DISMISSED', 'CONTACTED'],
    ['DISMISSED', 'BOOKED'],
  ]

  it('the matrix itself still allows PENDING/CONTACTED → BOOKED (the appointment check is a separate domain rule)', () => {
    expect(() => assertValidFollowUpTransition('PENDING', 'BOOKED')).not.toThrow()
    expect(() => assertValidFollowUpTransition('CONTACTED', 'BOOKED')).not.toThrow()
  })

  it.each(allowed)('allows %s → %s', async (from, to) => {
    expect(() => assertValidFollowUpTransition(from, to)).not.toThrow()
    fuFindByIdMock.mockResolvedValue(makeFollowUp({ status: from }))

    const updated = await updateServiceFollowUp(ctx, FOLLOW_UP_ID, { status: to })

    expect(updated.status).toBe(to)
    expect(fuUpdateByIdMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, { status: to })
  })

  it.each(forbidden)('rejects %s → %s with 400 INVALID_STATUS_TRANSITION', async (from, to) => {
    fuFindByIdMock.mockResolvedValue(makeFollowUp({ status: from }))

    await expectApiError(updateServiceFollowUp(ctx, FOLLOW_UP_ID, { status: to }), 400, 'INVALID_STATUS_TRANSITION')
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })

  it('"Отложить" changes dueAt only and keeps the follow-up PENDING', async () => {
    const updated = await updateServiceFollowUp(ctx, FOLLOW_UP_ID, { dueAt: '2026-10-15' })

    expect(fuUpdateByIdMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, { dueAt: new Date('2026-10-14T21:00:00.000Z') })
    expect(updated.status).toBe('PENDING')
  })

  it.each(['BOOKED', 'DISMISSED'] as const)('a %s follow-up cannot be rescheduled', async (status) => {
    fuFindByIdMock.mockResolvedValue(makeFollowUp({ status }))

    await expectApiError(updateServiceFollowUp(ctx, FOLLOW_UP_ID, { dueAt: '2026-10-15' }), 400, 'VALIDATION_ERROR')
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })

  it('an unknown/foreign follow-up is a 404 and nothing is written', async () => {
    fuFindByIdMock.mockResolvedValue(null)

    await expectApiError(updateServiceFollowUp(ctx, FOLLOW_UP_ID, { status: 'DISMISSED' }), 404, 'NOT_FOUND')
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })
})

describe('"Создать обращение" — CustomerRequest from a follow-up', () => {
  // Prompt 48.1 — the follow-up is read once without a lock (validation
  // phase) and again under SELECT … FOR UPDATE inside the transaction.
  function followUpIs(row: ReturnType<typeof makeFollowUp>) {
    fuFindByIdMock.mockResolvedValue(row)
    fuFindByIdForUpdateMock.mockResolvedValue(row)
  }

  it('creates one CustomerRequest with the follow-up customer, vehicle and service, source MANUAL, status NEW — inside the transaction', async () => {
    followUpIs(makeFollowUp({ note: 'Позвонить после 18:00' }))

    const result = await createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID)

    // The follow-up row is locked first, scoped to the requesting tenant/business.
    expect(fuFindByIdForUpdateMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, TX)
    expect(crCreateWithInitialHistoryMock).toHaveBeenCalledTimes(1)
    const [data, changedBy, tx] = crCreateWithInitialHistoryMock.mock.calls[0]!
    expect(data).toMatchObject({
      tenantId: 't1',
      businessId: 'b1',
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      source: 'MANUAL',
      status: 'NEW',
      subject: 'Повторное обслуживание: Замена масла',
      description: 'Позвонить после 18:00',
    })
    expect(changedBy).toBe('u1')
    expect(tx).toBe(TX)
    expect(fuUpdateByIdMock).toHaveBeenCalledWith('t1', 'b1', FOLLOW_UP_ID, { customerRequestId: REQUEST_ID, status: 'CONTACTED' }, TX)
    expect(result.created).toBe(true)
    expect(result.request.id).toBe(REQUEST_ID)
    expect(result.followUp.status).toBe('CONTACTED')
    expect(result.followUp.customerRequestId).toBe(REQUEST_ID)
  })

  it('a follow-up without a service creates a request without serviceId', async () => {
    followUpIs(makeFollowUp({ serviceId: null }))

    await createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID)

    const [data] = crCreateWithInitialHistoryMock.mock.calls[0]!
    expect(data.serviceId).toBeNull()
    expect(data.subject).toBe('Повторный контакт после обслуживания')
    expect(serviceFindByIdMock).not.toHaveBeenCalled()
  })

  it('an already-linked follow-up is answered from the plain read — no transaction, no lock, nothing created', async () => {
    followUpIs(makeFollowUp({ status: 'CONTACTED', customerRequestId: REQUEST_ID }))

    const result = await createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID)

    expect(fuFindByIdForUpdateMock).not.toHaveBeenCalled()
    expect(crFindByIdMock).toHaveBeenCalledWith('t1', 'b1', REQUEST_ID)
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
    expect(result.created).toBe(false)
    expect(result.request.id).toBe(REQUEST_ID)
  })

  it('the follow-up changed between validation and the lock → 409 CONFLICT, nothing inserted', async () => {
    fuFindByIdMock.mockResolvedValue(makeFollowUp())
    fuFindByIdForUpdateMock.mockResolvedValue(makeFollowUp({ vehicleId: '99999999-9999-4999-8999-999999999999' }))

    await expectApiError(createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID), 409, 'CONFLICT')
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })

  it('is idempotent under a race: linked by another call while this one waited on the lock → returns that request', async () => {
    fuFindByIdForUpdateMock.mockResolvedValue(makeFollowUp({ status: 'CONTACTED', customerRequestId: REQUEST_ID }))

    const result = await createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID)

    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
    expect(txCustomerRequestFindFirstMock).toHaveBeenCalledWith({ where: { businessId: 'b1', id: REQUEST_ID, tenantId: 't1' } })
    expect(result.created).toBe(false)
    expect(result.request.id).toBe(REQUEST_ID)
  })

  it('stays idempotent after the follow-up became BOOKED: returns the existing request', async () => {
    fuFindByIdForUpdateMock.mockResolvedValue(makeFollowUp({ status: 'BOOKED', customerRequestId: REQUEST_ID }))

    const result = await createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID)

    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
    expect(result.created).toBe(false)
  })

  it.each(['BOOKED', 'DISMISSED'] as const)('a %s follow-up without a request never creates one', async (status) => {
    fuFindByIdForUpdateMock.mockResolvedValue(makeFollowUp({ status }))

    await expectApiError(createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID), 400, 'VALIDATION_ERROR')
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
  })

  it('a foreign/unknown follow-up is a 404 and no request is created', async () => {
    fuFindByIdForUpdateMock.mockResolvedValue(null)

    await expectApiError(createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID), 404, 'NOT_FOUND')
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
  })

  it('the request goes through the normal request validation (inactive customer → 400, nothing linked)', async () => {
    customerFindByIdMock.mockResolvedValue({ id: CUSTOMER_ID, tenantId: 't1', businessId: 'b1', isActive: false })

    await expectApiError(createCustomerRequestFromFollowUp(ctx, FOLLOW_UP_ID), 400)
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
    expect(fuUpdateByIdMock).not.toHaveBeenCalled()
  })
})

describe('BOOKED — only when the linked request is really CONVERTED to an appointment', () => {
  // updateWithStatusHistory's 6th argument is the in-transaction hook.
  function runStatusHook(result: Record<string, unknown>) {
    crUpdateWithStatusHistoryMock.mockImplementation(async (...args: unknown[]) => {
      const hook = args[5] as ((tx: unknown) => Promise<void>) | undefined
      if (hook) await hook(TX)
      return result
    })
  }

  it('converting the linked request marks its open follow-up BOOKED — in the same transaction as the status change', async () => {
    crFindByIdMock.mockResolvedValue({
      id: REQUEST_ID,
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      appointmentId: APPOINTMENT_ID,
      status: 'QUALIFIED',
      requestedTimeFrom: null,
      requestedTimeTo: null,
    })
    runStatusHook({ id: REQUEST_ID, status: 'CONVERTED' })

    await updateCustomerRequest(ctx, REQUEST_ID, { status: 'CONVERTED' })

    expect(fuMarkBookedMock).toHaveBeenCalledWith('t1', 'b1', REQUEST_ID, TX)
  })

  it('any other request status change leaves follow-ups alone', async () => {
    crFindByIdMock.mockResolvedValue({ id: REQUEST_ID, customerId: CUSTOMER_ID, appointmentId: null, status: 'NEW', requestedTimeFrom: null, requestedTimeTo: null })
    runStatusHook({ id: REQUEST_ID, status: 'IN_PROGRESS' })

    await updateCustomerRequest(ctx, REQUEST_ID, { status: 'IN_PROGRESS' })

    expect(fuMarkBookedMock).not.toHaveBeenCalled()
  })

  it('a rejected CONVERTED (no appointment) never marks anything BOOKED', async () => {
    crFindByIdMock.mockResolvedValue({ id: REQUEST_ID, customerId: CUSTOMER_ID, appointmentId: null, status: 'QUALIFIED', requestedTimeFrom: null, requestedTimeTo: null })

    await expectApiError(updateCustomerRequest(ctx, REQUEST_ID, { status: 'CONVERTED' }), 400)
    expect(fuMarkBookedMock).not.toHaveBeenCalled()
  })
})

describe('Business-timezone date math', () => {
  it('addDaysToDateKey crosses month and year boundaries', () => {
    expect(addDaysToDateKey('2026-12-25', 10)).toBe('2027-01-04')
    expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('the due day is counted from the Business-local day of the visit, not its UTC day', () => {
    // 2026-09-29T22:30Z is already 2026-09-30 01:30 in Moscow → +1 day = 2026-10-01 (Moscow midnight = 09-30T21:00Z).
    expect(followUpDueAtFromInterval(new Date('2026-09-29T22:30:00.000Z'), 1, 'Europe/Moscow')).toEqual(
      new Date('2026-09-30T21:00:00.000Z')
    )
  })

  it('local midnight is DST-aware (Europe/Berlin): winter, summer, and both switch days', () => {
    expect(followUpDueAtFromDateKey('2026-01-15', 'Europe/Berlin')).toEqual(new Date('2026-01-14T23:00:00.000Z'))
    expect(followUpDueAtFromDateKey('2026-07-15', 'Europe/Berlin')).toEqual(new Date('2026-07-14T22:00:00.000Z'))
    // DST starts 2026-03-29 at 02:00 — midnight that day is still CET (+1).
    expect(followUpDueAtFromDateKey('2026-03-29', 'Europe/Berlin')).toEqual(new Date('2026-03-28T23:00:00.000Z'))
    // DST ends 2026-10-25 at 03:00 — midnight that day is still CEST (+2).
    expect(followUpDueAtFromDateKey('2026-10-25', 'Europe/Berlin')).toEqual(new Date('2026-10-24T22:00:00.000Z'))
  })

  it('uses the Business timezone from the auth context when creating a follow-up', async () => {
    const berlinCtx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'Europe/Berlin' }) })
    serviceFindByIdMock.mockResolvedValue(makeService({ repeatIntervalDays: 1 }))

    // 2026-03-28 12:00 Berlin + 1 day = 2026-03-29 (DST switch day) → 2026-03-28T23:00Z.
    await createServiceRecord(berlinCtx, createInput({ performedAt: new Date('2026-03-28T11:00:00.000Z') }))

    expect(fuCreateMock.mock.calls[0]![0].dueAt).toEqual(new Date('2026-03-28T23:00:00.000Z'))
  })
})
