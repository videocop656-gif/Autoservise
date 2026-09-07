import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listMock, findByIdMock, createMock, updateByIdMock, deactivateMock, customerFindByIdMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  findByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateByIdMock: vi.fn(),
  deactivateMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: {
    list: listMock,
    findById: findByIdMock,
    create: createMock,
    updateById: updateByIdMock,
    deactivate: deactivateMock,
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: customerFindByIdMock },
}))

import { listVehicles, getVehicle, createVehicle, updateVehicle, deactivateVehicle } from '../src/server/services/vehicleService'

function makeVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: 'c1',
    make: 'Toyota',
    model: 'Camry',
    year: 2020,
    licensePlate: 'A123BC',
    vin: null,
    mileage: null,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listVehicles', () => {
  it('scopes to tenant/business and forwards filters', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listVehicles(ctx, { page: 1, pageSize: 20, activeOnly: true, customerId: 'c1' })
    expect(listMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      activeOnly: true,
      search: undefined,
      customerId: 'c1',
      skip: 0,
      take: 20,
    })
  })
})

describe('getVehicle', () => {
  it('returns 404 for an unknown vehicle', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(getVehicle(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('createVehicle', () => {
  it('allows owner/admin to create when the customer exists in this tenant/business', async () => {
    customerFindByIdMock.mockResolvedValue({ id: 'c1' })
    createMock.mockResolvedValue(makeVehicle())
    const ctx = makeAuthContext('owner')
    await createVehicle(ctx, { customerId: 'c1', make: 'Toyota', model: 'Camry' })
    expect(customerFindByIdMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'c1')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, customerId: 'c1' })
    )
  })

  it('rejects manager from creating', async () => {
    await expect(
      createVehicle(makeAuthContext('manager'), { customerId: 'c1', make: 'Toyota', model: 'Camry' })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(customerFindByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the customer does not exist / belongs to another tenant', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(
      createVehicle(makeAuthContext('owner'), { customerId: 'foreign-customer', make: 'Toyota', model: 'Camry' })
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('updateVehicle', () => {
  it('rejects manager from updating', async () => {
    await expect(updateVehicle(makeAuthContext('manager'), 'v1', { make: 'Honda' })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(updateByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant vehicle', async () => {
    updateByIdMock.mockResolvedValue(null)
    await expect(updateVehicle(makeAuthContext('owner'), 'unknown', { make: 'Honda' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('deactivateVehicle', () => {
  it('is idempotent and rejects manager', async () => {
    deactivateMock.mockResolvedValue(1)
    await expect(deactivateVehicle(makeAuthContext('owner'), 'v1')).resolves.toBeUndefined()
    await expect(deactivateVehicle(makeAuthContext('manager'), 'v1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 for an unknown/foreign-tenant vehicle', async () => {
    deactivateMock.mockResolvedValue(0)
    await expect(deactivateVehicle(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })
})
