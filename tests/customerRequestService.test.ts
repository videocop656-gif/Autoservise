import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const {
  crListMock,
  crFindByIdMock,
  crFindByIdWithHistoryMock,
  crUpdateByIdMock,
  crCreateWithInitialHistoryMock,
  crUpdateWithStatusHistoryMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  serviceFindByIdMock,
  appointmentFindByIdMock,
} = vi.hoisted(() => ({
  crListMock: vi.fn(),
  crFindByIdMock: vi.fn(),
  crFindByIdWithHistoryMock: vi.fn(),
  crUpdateByIdMock: vi.fn(),
  crCreateWithInitialHistoryMock: vi.fn(),
  crUpdateWithStatusHistoryMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  serviceFindByIdMock: vi.fn(),
  appointmentFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: {
    list: crListMock,
    findById: crFindByIdMock,
    findByIdWithHistory: crFindByIdWithHistoryMock,
    updateById: crUpdateByIdMock,
    createWithInitialHistory: crCreateWithInitialHistoryMock,
    updateWithStatusHistory: crUpdateWithStatusHistoryMock,
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
  listCustomerRequests,
  getCustomerRequest,
  createCustomerRequest,
  updateCustomerRequest,
} from '../src/server/services/customerRequestService'

const CUSTOMER_ID = 'c1'
const VEHICLE_ID = 'v1'
const SERVICE_ID = 's1'
const APPOINTMENT_ID = 'a1'

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return { id: CUSTOMER_ID, tenantId: 't1', businessId: 'b1', isActive: true, ...overrides }
}
function makeVehicle(overrides: Record<string, unknown> = {}) {
  return { id: VEHICLE_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, isActive: true, ...overrides }
}
function makeSvc(overrides: Record<string, unknown> = {}) {
  return { id: SERVICE_ID, tenantId: 't1', businessId: 'b1', isActive: true, ...overrides }
}
function makeAppt(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_ID,
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    ...overrides,
  }
}
function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    appointmentId: null,
    source: 'MANUAL',
    status: 'NEW',
    subject: 'Стук спереди',
    description: null,
    requestedDate: null,
    requestedTimeFrom: null,
    requestedTimeTo: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    subject: 'Стук спереди',
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue(makeCustomer())
  vehicleFindByIdMock.mockResolvedValue(makeVehicle())
  serviceFindByIdMock.mockResolvedValue(makeSvc())
  appointmentFindByIdMock.mockResolvedValue(makeAppt())
  crCreateWithInitialHistoryMock.mockResolvedValue(makeRequest())
})

describe('listCustomerRequests', () => {
  it('scopes to tenant/business and forwards filters/pagination', async () => {
    crListMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listCustomerRequests(ctx, { page: 1, pageSize: 20 })
    expect(crListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { page: 1, pageSize: 20, skip: 0, take: 20 })
  })
})

describe('getCustomerRequest', () => {
  it('returns 404 for an unknown request', async () => {
    crFindByIdWithHistoryMock.mockResolvedValue(null)
    await expect(getCustomerRequest(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('includes status history', async () => {
    crFindByIdWithHistoryMock.mockResolvedValue(makeRequest({ statusHistory: [{ toStatus: 'NEW' }] }))
    const result = await getCustomerRequest(makeAuthContext('owner'), 'r1')
    expect(result.statusHistory).toEqual([{ toStatus: 'NEW' }])
  })
})

describe('createCustomerRequest — permissions', () => {
  it('allows owner, admin, AND manager to create', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      crCreateWithInitialHistoryMock.mockResolvedValue(makeRequest())
      await expect(createCustomerRequest(makeAuthContext(role), baseInput())).resolves.toBeDefined()
    }
  })
})

describe('createCustomerRequest — ownership & active state', () => {
  it('returns 404 when the customer belongs to another tenant / does not exist', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(createCustomerRequest(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 404 })
    expect(crCreateWithInitialHistoryMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the customer is inactive', async () => {
    customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
    await expect(createCustomerRequest(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when the vehicle belongs to another tenant / does not exist', async () => {
    vehicleFindByIdMock.mockResolvedValue(null)
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ vehicleId: VEHICLE_ID }))
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the vehicle belongs to a different customer', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ customerId: 'someone-else' }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ vehicleId: VEHICLE_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('does NOT require the vehicle to be active (a request can be about an inactive vehicle)', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ isActive: false }))
    await expect(createCustomerRequest(makeAuthContext('owner'), baseInput({ vehicleId: VEHICLE_ID }))).resolves.toBeDefined()
  })

  it('returns 404 when the service belongs to another tenant / does not exist', async () => {
    serviceFindByIdMock.mockResolvedValue(null)
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ serviceId: SERVICE_ID }))
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the service is inactive', async () => {
    serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ serviceId: SERVICE_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createCustomerRequest — appointment consistency', () => {
  it('accepts a matching appointment', async () => {
    crCreateWithInitialHistoryMock.mockResolvedValue(makeRequest({ appointmentId: APPOINTMENT_ID }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).resolves.toBeDefined()
  })

  it('returns 404 when the appointment belongs to another tenant / does not exist', async () => {
    appointmentFindByIdMock.mockResolvedValue(null)
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the appointment belongs to a different customer', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ customerId: 'someone-else' }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the appointment is for a different vehicle (vehicleId specified on the request)', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ vehicleId: 'other-vehicle' }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ vehicleId: VEHICLE_ID, appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the appointment is for a different service (serviceId specified on the request)', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ serviceId: 'other-service' }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ serviceId: SERVICE_ID, appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('does not cross-check vehicle/service when the request itself does not specify them', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ vehicleId: 'other-vehicle', serviceId: 'other-service' }))
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).resolves.toBeDefined()
  })

  it('does not look up an appointment at all when none is provided', async () => {
    await createCustomerRequest(makeAuthContext('owner'), baseInput())
    expect(appointmentFindByIdMock).not.toHaveBeenCalled()
    expect(crCreateWithInitialHistoryMock).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: null }), 'u1')
  })
})

describe('createCustomerRequest — always starts at NEW', () => {
  it('creates with status NEW regardless of appointmentId', async () => {
    await createCustomerRequest(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    expect(crCreateWithInitialHistoryMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEW' }), 'u1')
  })
})

describe('createCustomerRequest — requestedTimeFrom/requestedTimeTo', () => {
  it('accepts a valid range', async () => {
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ requestedTimeFrom: '09:00', requestedTimeTo: '15:00' }))
    ).resolves.toBeDefined()
  })

  it('rejects an inverted range at the service layer too (defense in depth)', async () => {
    await expect(
      createCustomerRequest(makeAuthContext('owner'), baseInput({ requestedTimeFrom: '18:00', requestedTimeTo: '09:00' }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createCustomerRequest — source & requestedDate', () => {
  it('defaults source to MANUAL when omitted', async () => {
    await createCustomerRequest(makeAuthContext('owner'), baseInput())
    expect(crCreateWithInitialHistoryMock).toHaveBeenCalledWith(expect.objectContaining({ source: 'MANUAL' }), 'u1')
  })

  it('uses an explicitly provided source', async () => {
    await createCustomerRequest(makeAuthContext('owner'), baseInput({ source: 'PHONE' }))
    expect(crCreateWithInitialHistoryMock).toHaveBeenCalledWith(expect.objectContaining({ source: 'PHONE' }), 'u1')
  })

  it('normalizes requestedDate to Business-local midnight UTC', async () => {
    const ctx = makeAuthContext('owner', { business: { ...makeAuthContext().business, timezone: 'Europe/Moscow' } })
    // 23:30 UTC on the 10th is already 02:30 local on the 11th in Moscow (UTC+3).
    await createCustomerRequest(ctx, baseInput({ requestedDate: '2026-09-10T23:30:00Z' }))
    const call = crCreateWithInitialHistoryMock.mock.calls[0]![0] as { requestedDate: Date }
    expect(call.requestedDate.toISOString()).toBe('2026-09-11T00:00:00.000Z')
  })
})

describe('updateCustomerRequest', () => {
  beforeEach(() => {
    crFindByIdMock.mockResolvedValue(makeRequest())
    crUpdateByIdMock.mockResolvedValue(makeRequest({ notes: 'Updated' }))
    crUpdateWithStatusHistoryMock.mockResolvedValue(makeRequest({ status: 'IN_PROGRESS' }))
  })

  it('returns 404 for an unknown/foreign-tenant request', async () => {
    crFindByIdMock.mockResolvedValue(null)
    await expect(updateCustomerRequest(makeAuthContext('owner'), 'unknown', { notes: 'x' } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('a plain field edit does NOT re-check ownership/active state and uses the plain update path', async () => {
    await updateCustomerRequest(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)
    expect(customerFindByIdMock).not.toHaveBeenCalled()
    expect(vehicleFindByIdMock).not.toHaveBeenCalled()
    expect(serviceFindByIdMock).not.toHaveBeenCalled()
    expect(crUpdateByIdMock).toHaveBeenCalled()
    expect(crUpdateWithStatusHistoryMock).not.toHaveBeenCalled()
  })

  it('re-validates ownership/active state when a relation IS being changed', async () => {
    serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
    await expect(
      updateCustomerRequest(makeAuthContext('owner'), 'r1', { serviceId: SERVICE_ID } as never)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  describe('historical behavior — deactivated related entities never block a plain edit', () => {
    it('editing notes still works after the Customer is deactivated', async () => {
      customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)).resolves.toBeDefined()
    })

    it('editing notes still works after the Service is deactivated', async () => {
      serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)).resolves.toBeDefined()
    })

    it('changing customerId does NOT require the new customer to be active (unlike create)', async () => {
      // No vehicleId/serviceId on the existing request, so only the customer
      // active-state rule is under test here.
      crFindByIdMock.mockResolvedValue(makeRequest({ vehicleId: null, serviceId: null }))
      customerFindByIdMock.mockResolvedValue(makeCustomer({ id: 'new-customer', isActive: false }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { customerId: 'new-customer' } as never)
      ).resolves.toBeDefined()
    })
  })

  describe('status transitions', () => {
    it('allows NEW -> IN_PROGRESS', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'NEW' }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'IN_PROGRESS' } as never)).resolves.toBeDefined()
    })

    it('allows IN_PROGRESS -> WAITING_CUSTOMER -> IN_PROGRESS', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'IN_PROGRESS' }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'WAITING_CUSTOMER' } as never)
      ).resolves.toBeDefined()
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'WAITING_CUSTOMER' }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'IN_PROGRESS' } as never)).resolves.toBeDefined()
    })

    it('allows IN_PROGRESS -> QUALIFIED', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'IN_PROGRESS' }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'QUALIFIED' } as never)).resolves.toBeDefined()
    })

    it('allows QUALIFIED -> CONVERTED when an appointment is linked', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'QUALIFIED', appointmentId: APPOINTMENT_ID }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'CONVERTED' } as never)).resolves.toBeDefined()
    })

    it.each([
      ['NEW', 'QUALIFIED'],
      ['NEW', 'CONVERTED'],
      ['NEW', 'WAITING_CUSTOMER'],
      ['WAITING_CUSTOMER', 'QUALIFIED'],
      ['QUALIFIED', 'IN_PROGRESS'],
      ['QUALIFIED', 'NEW'],
    ])('rejects invalid transition %s -> %s', async (from, to) => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: from }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: to } as never)).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    it.each(['CONVERTED', 'CLOSED', 'CANCELLED'])('terminal status %s never transitions anywhere else', async (terminal) => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: terminal, appointmentId: APPOINTMENT_ID }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'IN_PROGRESS' } as never)).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    it('re-submitting the same status is a no-op (allowed, no error) and takes the plain update path', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'NEW' }))
      await updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'NEW' } as never)
      expect(crUpdateWithStatusHistoryMock).not.toHaveBeenCalled()
      expect(crUpdateByIdMock).toHaveBeenCalled()
    })

    it('a genuine status change uses the history-recording update path with fromStatus/toStatus/changedByUserId', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'NEW' }))
      const ctx = makeAuthContext('owner')
      await updateCustomerRequest(ctx, 'r1', { status: 'IN_PROGRESS' } as never)
      expect(crUpdateWithStatusHistoryMock).toHaveBeenCalledWith(
        ctx.tenant.id,
        ctx.business.id,
        'r1',
        expect.anything(),
        { fromStatus: 'NEW', toStatus: 'IN_PROGRESS', changedByUserId: ctx.user.id }
      )
    })

    it('rejects becoming CONVERTED without a linked appointment', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'QUALIFIED', appointmentId: null }))
      await expect(updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'CONVERTED' } as never)).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    it('allows becoming CONVERTED when appointmentId is supplied in the same PATCH', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'QUALIFIED', appointmentId: null }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { status: 'CONVERTED', appointmentId: APPOINTMENT_ID } as never)
      ).resolves.toBeDefined()
    })

    it('rejects clearing appointmentId on an already-CONVERTED request', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'CONVERTED', appointmentId: APPOINTMENT_ID }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { appointmentId: null } as never)
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('Manager can change status', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ status: 'NEW' }))
      await expect(
        updateCustomerRequest(makeAuthContext('manager'), 'r1', { status: 'IN_PROGRESS' } as never)
      ).resolves.toBeDefined()
    })
  })

  describe('requestedTimeFrom/requestedTimeTo merge on partial update', () => {
    it('rejects when the new requestedTimeFrom would be after the existing requestedTimeTo', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ requestedTimeFrom: '09:00', requestedTimeTo: '10:00' }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { requestedTimeFrom: '11:00' } as never)
      ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('accepts changing just one side when it stays consistent with the other', async () => {
      crFindByIdMock.mockResolvedValue(makeRequest({ requestedTimeFrom: '09:00', requestedTimeTo: '18:00' }))
      await expect(
        updateCustomerRequest(makeAuthContext('owner'), 'r1', { requestedTimeFrom: '10:00' } as never)
      ).resolves.toBeDefined()
    })
  })
})
