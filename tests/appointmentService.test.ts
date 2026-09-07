import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'

const {
  aptListMock,
  aptFindByIdMock,
  aptCreateMock,
  aptUpdateByIdMock,
  aptFindConflictMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  serviceFindByIdMock,
  hoursListByBusinessMock,
} = vi.hoisted(() => ({
  aptListMock: vi.fn(),
  aptFindByIdMock: vi.fn(),
  aptCreateMock: vi.fn(),
  aptUpdateByIdMock: vi.fn(),
  aptFindConflictMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  serviceFindByIdMock: vi.fn(),
  hoursListByBusinessMock: vi.fn(),
}))

vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: {
    list: aptListMock,
    findById: aptFindByIdMock,
    create: aptCreateMock,
    updateById: aptUpdateByIdMock,
    findConflict: aptFindConflictMock,
  },
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
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
vi.mock('../src/server/repositories/workingHoursRepository', () => ({
  workingHoursRepository: { listByBusiness: hoursListByBusinessMock },
}))

import { listAppointments, getAppointment, createAppointment, updateAppointment } from '../src/server/services/appointmentService'

const CUSTOMER_ID = 'c1'
const VEHICLE_ID = 'v1'
const SERVICE_ID = 's1'

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return { id: CUSTOMER_ID, tenantId: 't1', businessId: 'b1', firstName: 'Ivan', isActive: true, ...overrides }
}
function makeVehicle(overrides: Record<string, unknown> = {}) {
  return { id: VEHICLE_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, make: 'Toyota', isActive: true, ...overrides }
}
function makeSvc(overrides: Record<string, unknown> = {}) {
  return { id: SERVICE_ID, tenantId: 't1', businessId: 'b1', name: 'Oil change', isActive: true, ...overrides }
}
function makeAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    startAt: new Date('2026-09-07T06:00:00Z'), // Monday 09:00 Europe/Moscow (UTC+3)
    endAt: new Date('2026-09-07T07:00:00Z'), // Monday 10:00 Europe/Moscow
    status: 'SCHEDULED',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// Standard Mon-Fri 09:00-18:00 / Sat 10:00-15:00 / Sun closed week, exactly
// the Prompt 02 defaults — reused, not reinvented.
const STANDARD_WEEK = [
  { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'TUESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'WEDNESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'THURSDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'FRIDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'SATURDAY', isOpen: true, openTime: '10:00', closeTime: '15:00' },
  { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
]

function inputAt(startIso: string, endIso: string, overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    startAt: new Date(startIso),
    endAt: new Date(endIso),
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue(makeCustomer())
  vehicleFindByIdMock.mockResolvedValue(makeVehicle())
  serviceFindByIdMock.mockResolvedValue(makeSvc())
  hoursListByBusinessMock.mockResolvedValue(STANDARD_WEEK)
  aptFindConflictMock.mockResolvedValue(null)
  aptCreateMock.mockResolvedValue(makeAppointment())
})

describe('listAppointments', () => {
  it('scopes to tenant/business and forwards filters/pagination', async () => {
    aptListMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listAppointments(ctx, { page: 1, pageSize: 20, includeCancelled: false })
    expect(aptListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      page: 1,
      pageSize: 20,
      includeCancelled: false,
      skip: 0,
      take: 20,
    })
  })
})

describe('getAppointment', () => {
  it('returns 404 for an unknown appointment', async () => {
    aptFindByIdMock.mockResolvedValue(null)
    await expect(getAppointment(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('createAppointment — permissions', () => {
  it('allows owner, admin, AND manager to create (operational workflow, unlike Settings entities)', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      aptCreateMock.mockResolvedValue(makeAppointment())
      const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
      await expect(createAppointment(makeAuthContext(role), input)).resolves.toBeDefined()
    }
  })
})

describe('createAppointment — ownership & active state', () => {
  it('returns 404 when the customer belongs to another tenant / does not exist', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 404 })
    expect(aptCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the customer is inactive', async () => {
    customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when the vehicle belongs to another tenant / does not exist', async () => {
    vehicleFindByIdMock.mockResolvedValue(null)
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the vehicle belongs to a different customer in the same tenant', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ customerId: 'someone-else' }))
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the vehicle is inactive', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ isActive: false }))
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when the service belongs to another tenant / does not exist', async () => {
    serviceFindByIdMock.mockResolvedValue(null)
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the service is inactive', async () => {
    serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createAppointment — working hours (Europe/Moscow, UTC+3)', () => {
  // Monday 2026-09-07. 06:00 UTC = 09:00 Moscow (open). 15:00 UTC = 18:00 Moscow (close).
  it('accepts an appointment fully inside working hours', async () => {
    const input = inputAt('2026-09-07T07:00:00Z', '2026-09-07T08:00:00Z') // 10:00-11:00 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).resolves.toBeDefined()
  })

  it('accepts an appointment starting exactly at openTime', async () => {
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z') // 09:00-10:00 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).resolves.toBeDefined()
  })

  it('accepts an appointment ending exactly at closeTime', async () => {
    const input = inputAt('2026-09-07T14:00:00Z', '2026-09-07T15:00:00Z') // 17:00-18:00 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).resolves.toBeDefined()
  })

  it('rejects an appointment starting before opening', async () => {
    const input = inputAt('2026-09-07T05:00:00Z', '2026-09-07T07:00:00Z') // 08:00-10:00 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an appointment ending after closing', async () => {
    const input = inputAt('2026-09-07T14:30:00Z', '2026-09-07T15:30:00Z') // 17:30-18:30 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects any appointment on a closed day (Sunday)', async () => {
    // 2026-09-13 is a Sunday. 07:00 UTC = 10:00 Moscow.
    const input = inputAt('2026-09-13T07:00:00Z', '2026-09-13T08:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects an appointment that crosses local midnight, even if the UTC interval looks fine', async () => {
    // 21:30 UTC Sep 7 = 00:30 Moscow Sep 8; 22:30 UTC Sep 7 = 01:30 Moscow Sep 8 — same local day actually.
    // Use a genuine cross: 20:30 UTC (23:30 Moscow Sep 7) -> 21:30 UTC (00:30 Moscow Sep 8).
    const input = inputAt('2026-09-07T20:30:00Z', '2026-09-07T21:30:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('uses the CURRENT Business.timezone from ctx, not a fixed/server timezone', async () => {
    // Same UTC instant that is valid (09:00-10:00) in Moscow is 06:00-07:00
    // in a UTC+0 business, before the 09:00 opening — must be rejected there.
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'UTC' }) })
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(ctx, input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('DST: the same working-hours check correctly handles a Business in a DST-observing timezone', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'America/New_York' }) })
    // 2026-07-13 is a Monday. In July, New York is EDT (UTC-4).
    // 13:00 UTC = 09:00 EDT (opens 09:00) -> valid.
    const validInput = inputAt('2026-07-13T13:00:00Z', '2026-07-13T14:00:00Z')
    await expect(createAppointment(ctx, validInput)).resolves.toBeDefined()

    // The same 13:00 UTC in January (EST, UTC-5) is 08:00 EST — before opening -> invalid.
    const janCtx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'America/New_York' }) })
    const invalidInput = inputAt('2026-01-12T13:00:00Z', '2026-01-12T14:00:00Z') // 2026-01-12 is also a Monday
    await expect(createAppointment(janCtx, invalidInput)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createAppointment — duration', () => {
  it('rejects endAt <= startAt', async () => {
    const input = inputAt('2026-09-07T07:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a duration under 15 minutes', async () => {
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T06:10:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a duration over 24 hours', async () => {
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-08T06:00:01Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createAppointment — conflict detection', () => {
  it('returns 409 with a conflictingAppointmentId when the vehicle is already booked', async () => {
    aptFindConflictMock.mockResolvedValue(makeAppointment({ id: 'existing-1' }))
    const input = inputAt('2026-09-07T06:00:00Z', '2026-09-07T07:00:00Z')
    await expect(createAppointment(makeAuthContext('owner'), input)).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPOINTMENT_CONFLICT',
      details: { conflictingAppointmentId: 'existing-1' },
    })
  })

  it('proceeds to create when the repository reports no conflict, calling findConflict with the right scope', async () => {
    aptFindConflictMock.mockResolvedValue(null)
    const input = inputAt('2026-09-07T08:00:00Z', '2026-09-07T09:00:00Z') // 11:00-12:00 Moscow
    await expect(createAppointment(makeAuthContext('owner'), input)).resolves.toBeDefined()
    expect(aptFindConflictMock).toHaveBeenCalledWith('t1', 'b1', VEHICLE_ID, expect.any(Date), expect.any(Date), undefined)
  })
})

describe('updateAppointment', () => {
  it('allows a valid status transition (SCHEDULED -> CONFIRMED)', async () => {
    aptFindByIdMock.mockResolvedValue(makeAppointment({ status: 'SCHEDULED' }))
    aptUpdateByIdMock.mockResolvedValue(makeAppointment({ status: 'CONFIRMED' }))
    const result = await updateAppointment(makeAuthContext('owner'), 'a1', { status: 'CONFIRMED' } as never)
    expect(result.status).toBe('CONFIRMED')
  })

  const VALID_TRANSITIONS: [string, string][] = [
    ['SCHEDULED', 'CONFIRMED'],
    ['CONFIRMED', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'COMPLETED'],
    ['SCHEDULED', 'CANCELLED'],
    ['CONFIRMED', 'CANCELLED'],
    ['SCHEDULED', 'NO_SHOW'],
  ]
  for (const [from, to] of VALID_TRANSITIONS) {
    it(`allows ${from} -> ${to}`, async () => {
      aptFindByIdMock.mockResolvedValue(makeAppointment({ status: from }))
      aptUpdateByIdMock.mockResolvedValue(makeAppointment({ status: to }))
      await expect(updateAppointment(makeAuthContext('owner'), 'a1', { status: to } as never)).resolves.toBeDefined()
    })
  }

  const INVALID_TRANSITIONS: [string, string][] = [
    ['COMPLETED', 'SCHEDULED'],
    ['COMPLETED', 'CONFIRMED'],
    ['COMPLETED', 'IN_PROGRESS'],
    ['CANCELLED', 'SCHEDULED'],
    ['CANCELLED', 'CONFIRMED'],
    ['NO_SHOW', 'SCHEDULED'],
    ['NO_SHOW', 'IN_PROGRESS'],
  ]
  for (const [from, to] of INVALID_TRANSITIONS) {
    it(`rejects ${from} -> ${to} (terminal statuses never reopen)`, async () => {
      aptFindByIdMock.mockResolvedValue(makeAppointment({ status: from }))
      await expect(updateAppointment(makeAuthContext('owner'), 'a1', { status: to } as never)).rejects.toMatchObject({
        statusCode: 400,
      })
      expect(aptUpdateByIdMock).not.toHaveBeenCalled()
    })
  }

  it('returns 404 for an unknown/foreign-tenant appointment', async () => {
    aptFindByIdMock.mockResolvedValue(null)
    await expect(updateAppointment(makeAuthContext('owner'), 'unknown', { status: 'CONFIRMED' } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('a status-only update does NOT re-check active state, even if the customer has since been deactivated', async () => {
    aptFindByIdMock.mockResolvedValue(makeAppointment({ status: 'IN_PROGRESS' }))
    customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
    aptUpdateByIdMock.mockResolvedValue(makeAppointment({ status: 'COMPLETED' }))
    await expect(updateAppointment(makeAuthContext('owner'), 'a1', { status: 'COMPLETED' } as never)).resolves.toBeDefined()
    expect(customerFindByIdMock).not.toHaveBeenCalled()
  })

  it('re-validates active state when the customer/vehicle/service IS being changed', async () => {
    aptFindByIdMock.mockResolvedValue(makeAppointment())
    customerFindByIdMock.mockResolvedValue(makeCustomer({ id: 'new-customer', isActive: false }))
    await expect(
      updateAppointment(makeAuthContext('owner'), 'a1', { customerId: 'new-customer' } as never)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('excludes itself from the conflict check when only extending its own time range', async () => {
    aptFindByIdMock.mockResolvedValue(makeAppointment({ id: 'a1', startAt: new Date('2026-09-07T06:00:00Z'), endAt: new Date('2026-09-07T07:00:00Z') }))
    aptFindConflictMock.mockResolvedValue(null)
    aptUpdateByIdMock.mockResolvedValue(makeAppointment({ id: 'a1', endAt: new Date('2026-09-07T07:30:00Z') }))

    await updateAppointment(makeAuthContext('owner'), 'a1', { endAt: new Date('2026-09-07T07:30:00Z') } as never)

    expect(aptFindConflictMock).toHaveBeenCalledWith('t1', 'b1', VEHICLE_ID, expect.any(Date), expect.any(Date), 'a1')
  })

  it('does not re-check working hours or conflict when neither time nor vehicle changes (e.g. notes-only update)', async () => {
    aptFindByIdMock.mockResolvedValue(makeAppointment())
    aptUpdateByIdMock.mockResolvedValue(makeAppointment({ notes: 'Updated note' }))
    await updateAppointment(makeAuthContext('owner'), 'a1', { notes: 'Updated note' } as never)
    expect(aptFindConflictMock).not.toHaveBeenCalled()
    expect(hoursListByBusinessMock).not.toHaveBeenCalled()
  })

  it('returns 409 on conflict when rescheduling into an occupied slot', async () => {
    // Existing appointment is 06:00-07:00 UTC; move only the start to 06:30,
    // still comfortably before the unchanged 07:00 endAt.
    aptFindByIdMock.mockResolvedValue(makeAppointment())
    aptFindConflictMock.mockResolvedValue(makeAppointment({ id: 'other-appointment' }))
    await expect(
      updateAppointment(makeAuthContext('owner'), 'a1', { startAt: new Date('2026-09-07T06:30:00Z') } as never)
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
