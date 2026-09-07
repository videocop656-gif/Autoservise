import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const {
  srListMock,
  srFindByIdMock,
  srCreateMock,
  srUpdateByIdMock,
  srFindMaxActiveMileageMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  serviceFindByIdMock,
  appointmentFindByIdMock,
} = vi.hoisted(() => ({
  srListMock: vi.fn(),
  srFindByIdMock: vi.fn(),
  srCreateMock: vi.fn(),
  srUpdateByIdMock: vi.fn(),
  srFindMaxActiveMileageMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  serviceFindByIdMock: vi.fn(),
  appointmentFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/serviceRecordRepository', () => ({
  serviceRecordRepository: {
    list: srListMock,
    findById: srFindByIdMock,
    create: srCreateMock,
    updateById: srUpdateByIdMock,
    findMaxActiveMileage: srFindMaxActiveMileageMock,
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
  listServiceRecords,
  getServiceRecord,
  createServiceRecord,
  updateServiceRecord,
} from '../src/server/services/serviceRecordService'

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
  return { id: APPOINTMENT_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, ...overrides }
}
function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    appointmentId: null,
    performedAt: new Date('2026-09-07T09:00:00Z'),
    mileage: 50000,
    totalPrice: 1500,
    currency: 'RUB',
    workDescription: 'Oil change',
    partsDescription: null,
    recommendations: null,
    notes: null,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    performedAt: new Date('2026-09-07T09:00:00Z'),
    totalPrice: 1500,
    workDescription: 'Oil change',
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue(makeCustomer())
  vehicleFindByIdMock.mockResolvedValue(makeVehicle())
  serviceFindByIdMock.mockResolvedValue(makeSvc())
  appointmentFindByIdMock.mockResolvedValue(makeAppt())
  srFindMaxActiveMileageMock.mockResolvedValue(null)
  srCreateMock.mockResolvedValue(makeRecord())
})

describe('listServiceRecords', () => {
  it('scopes to tenant/business and forwards filters/pagination', async () => {
    srListMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listServiceRecords(ctx, { page: 1, pageSize: 20, includeArchived: false })
    expect(srListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      page: 1,
      pageSize: 20,
      includeArchived: false,
      skip: 0,
      take: 20,
    })
  })
})

describe('getServiceRecord', () => {
  it('returns 404 for an unknown record', async () => {
    srFindByIdMock.mockResolvedValue(null)
    await expect(getServiceRecord(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns an archived record too (archiving never revokes GET access)', async () => {
    srFindByIdMock.mockResolvedValue(makeRecord({ isArchived: true }))
    const result = await getServiceRecord(makeAuthContext('owner'), 'r1')
    expect(result.isArchived).toBe(true)
  })
})

describe('createServiceRecord — permissions', () => {
  it('allows owner, admin, AND manager to create', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      srCreateMock.mockResolvedValue(makeRecord())
      await expect(createServiceRecord(makeAuthContext(role), baseInput())).resolves.toBeDefined()
    }
  })
})

describe('createServiceRecord — ownership & active state', () => {
  it('returns 404 when the customer belongs to another tenant / does not exist', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 404 })
    expect(srCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the customer is inactive', async () => {
    customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when the vehicle belongs to another tenant / does not exist', async () => {
    vehicleFindByIdMock.mockResolvedValue(null)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the vehicle belongs to a different customer', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ customerId: 'someone-else' }))
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the vehicle is inactive', async () => {
    vehicleFindByIdMock.mockResolvedValue(makeVehicle({ isActive: false }))
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 404 when the service belongs to another tenant / does not exist', async () => {
    serviceFindByIdMock.mockResolvedValue(null)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the service is inactive', async () => {
    serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput())).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('createServiceRecord — appointment consistency', () => {
  it('accepts a matching appointment', async () => {
    srCreateMock.mockResolvedValue(makeRecord({ appointmentId: APPOINTMENT_ID }))
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))).resolves.toBeDefined()
  })

  it('returns 404 when the appointment belongs to another tenant / does not exist', async () => {
    appointmentFindByIdMock.mockResolvedValue(null)
    await expect(
      createServiceRecord(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 400 when the appointment belongs to a different customer', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ customerId: 'someone-else' }))
    await expect(
      createServiceRecord(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the appointment is for a different vehicle', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ vehicleId: 'other-vehicle' }))
    await expect(
      createServiceRecord(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('returns 400 when the appointment is for a different service', async () => {
    appointmentFindByIdMock.mockResolvedValue(makeAppt({ serviceId: 'other-service' }))
    await expect(
      createServiceRecord(makeAuthContext('owner'), baseInput({ appointmentId: APPOINTMENT_ID }))
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('does not look up an appointment at all when none is provided (historical record)', async () => {
    await createServiceRecord(makeAuthContext('owner'), baseInput())
    expect(appointmentFindByIdMock).not.toHaveBeenCalled()
    expect(srCreateMock).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: null }))
  })
})

describe('createServiceRecord — mileage validation', () => {
  it('accepts increasing mileage', async () => {
    srFindMaxActiveMileageMock.mockResolvedValue(35000)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput({ mileage: 50000 }))).resolves.toBeDefined()
  })

  it('accepts equal mileage', async () => {
    srFindMaxActiveMileageMock.mockResolvedValue(50000)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput({ mileage: 50000 }))).resolves.toBeDefined()
  })

  it('rejects decreasing mileage', async () => {
    srFindMaxActiveMileageMock.mockResolvedValue(50000)
    await expect(createServiceRecord(makeAuthContext('owner'), baseInput({ mileage: 45000 }))).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(srCreateMock).not.toHaveBeenCalled()
  })

  it('null mileage skips validation entirely', async () => {
    await createServiceRecord(makeAuthContext('owner'), baseInput({ mileage: null }))
    expect(srFindMaxActiveMileageMock).not.toHaveBeenCalled()
  })

  it('scopes the max-mileage lookup to tenant/business/vehicle', async () => {
    await createServiceRecord(makeAuthContext('owner'), baseInput({ mileage: 100 }))
    expect(srFindMaxActiveMileageMock).toHaveBeenCalledWith('t1', 'b1', VEHICLE_ID, undefined)
  })
})

describe('createServiceRecord — money & currency', () => {
  it('defaults currency from the business when omitted', async () => {
    await createServiceRecord(makeAuthContext('owner'), baseInput())
    expect(srCreateMock).toHaveBeenCalledWith(expect.objectContaining({ currency: 'RUB' }))
  })

  it('uses an explicitly provided currency', async () => {
    await createServiceRecord(makeAuthContext('owner'), baseInput({ currency: 'USD' }))
    expect(srCreateMock).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' }))
  })
})

describe('updateServiceRecord', () => {
  beforeEach(() => {
    srFindByIdMock.mockResolvedValue(makeRecord())
    srUpdateByIdMock.mockResolvedValue(makeRecord({ workDescription: 'Updated' }))
  })

  it('returns 404 for an unknown/foreign-tenant record', async () => {
    srFindByIdMock.mockResolvedValue(null)
    await expect(updateServiceRecord(makeAuthContext('owner'), 'unknown', { notes: 'x' } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('a plain field edit does NOT re-check ownership/active state', async () => {
    await updateServiceRecord(makeAuthContext('owner'), 'r1', { workDescription: 'Updated' } as never)
    expect(customerFindByIdMock).not.toHaveBeenCalled()
    expect(vehicleFindByIdMock).not.toHaveBeenCalled()
    expect(serviceFindByIdMock).not.toHaveBeenCalled()
  })

  it('re-validates ownership/active state when a relation IS being changed', async () => {
    customerFindByIdMock.mockResolvedValue(makeCustomer({ id: 'new-customer', isActive: false }))
    await expect(
      updateServiceRecord(makeAuthContext('owner'), 'r1', { customerId: 'new-customer' } as never)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  describe('historical behavior — deactivated related entities never block a plain edit', () => {
    it('editing notes still works after the Customer is deactivated', async () => {
      customerFindByIdMock.mockResolvedValue(makeCustomer({ isActive: false }))
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)).resolves.toBeDefined()
    })

    it('editing notes still works after the Vehicle is deactivated', async () => {
      vehicleFindByIdMock.mockResolvedValue(makeVehicle({ isActive: false }))
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)).resolves.toBeDefined()
    })

    it('editing notes still works after the Service is deactivated', async () => {
      serviceFindByIdMock.mockResolvedValue(makeSvc({ isActive: false }))
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { notes: 'x' } as never)).resolves.toBeDefined()
    })
  })

  describe('archive / restore', () => {
    it('archiving does not require mileage re-validation', async () => {
      srFindByIdMock.mockResolvedValue(makeRecord({ mileage: 100 }))
      srUpdateByIdMock.mockResolvedValue(makeRecord({ mileage: 100, isArchived: true }))
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { isArchived: true } as never)).resolves.toBeDefined()
      expect(srFindMaxActiveMileageMock).not.toHaveBeenCalled()
    })

    it('restoring re-validates mileage and rejects if now below the max', async () => {
      srFindByIdMock.mockResolvedValue(makeRecord({ mileage: 100, isArchived: true }))
      srFindMaxActiveMileageMock.mockResolvedValue(50000)
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { isArchived: false } as never)).rejects.toMatchObject({
        statusCode: 400,
      })
    })

    it('restoring succeeds when mileage is still valid', async () => {
      srFindByIdMock.mockResolvedValue(makeRecord({ mileage: 60000, isArchived: true }))
      srFindMaxActiveMileageMock.mockResolvedValue(50000)
      srUpdateByIdMock.mockResolvedValue(makeRecord({ mileage: 60000, isArchived: false }))
      await expect(updateServiceRecord(makeAuthContext('owner'), 'r1', { isArchived: false } as never)).resolves.toBeDefined()
    })

    it('Manager can archive and restore', async () => {
      srFindByIdMock.mockResolvedValue(makeRecord())
      srUpdateByIdMock.mockResolvedValue(makeRecord({ isArchived: true }))
      await expect(updateServiceRecord(makeAuthContext('manager'), 'r1', { isArchived: true } as never)).resolves.toBeDefined()
    })

    it('excludes the record itself from the mileage comparison (does not conflict with itself)', async () => {
      srFindByIdMock.mockResolvedValue(makeRecord({ mileage: 50000 }))
      srUpdateByIdMock.mockResolvedValue(makeRecord({ mileage: 50000 }))
      await updateServiceRecord(makeAuthContext('owner'), 'r1', { mileage: 50000 } as never)
      expect(srFindMaxActiveMileageMock).toHaveBeenCalledWith('t1', 'b1', VEHICLE_ID, 'r1')
    })
  })
})
