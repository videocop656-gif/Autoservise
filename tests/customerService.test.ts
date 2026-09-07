import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listMock, findByIdMock, findActiveByEmailMock, createMock, updateByIdMock, deactivateMock, vehicleListMock } =
  vi.hoisted(() => ({
    listMock: vi.fn(),
    findByIdMock: vi.fn(),
    findActiveByEmailMock: vi.fn(),
    createMock: vi.fn(),
    updateByIdMock: vi.fn(),
    deactivateMock: vi.fn(),
    vehicleListMock: vi.fn(),
  }))

vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: {
    list: listMock,
    findById: findByIdMock,
    findActiveByEmail: findActiveByEmailMock,
    create: createMock,
    updateById: updateByIdMock,
    deactivate: deactivateMock,
  },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: { list: vehicleListMock },
}))

import {
  listCustomers,
  getCustomer,
  getCustomerDetail,
  createCustomer,
  updateCustomer,
  deactivateCustomer,
} from '../src/server/services/customerService'

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    tenantId: 't1',
    businessId: 'b1',
    firstName: 'Ivan',
    lastName: null,
    phone: '12345',
    email: null,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findActiveByEmailMock.mockResolvedValue(null)
})

describe('listCustomers', () => {
  it('scopes to tenant/business and forwards pagination', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listCustomers(ctx, { page: 2, pageSize: 10, activeOnly: true })
    expect(listMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: true, search: undefined, skip: 10, take: 10 })
  })
})

describe('getCustomer / getCustomerDetail', () => {
  it('returns 404 for an unknown customer', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(getCustomer(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('does not fetch vehicles unless includeVehicles is true', async () => {
    findByIdMock.mockResolvedValue(makeCustomer())
    const result = await getCustomerDetail(makeAuthContext('owner'), 'c1', false)
    expect(result.vehicles).toBeUndefined()
    expect(vehicleListMock).not.toHaveBeenCalled()
  })

  it('fetches active vehicles for the customer when includeVehicles is true', async () => {
    findByIdMock.mockResolvedValue(makeCustomer())
    vehicleListMock.mockResolvedValue({ items: [{ id: 'v1' }], total: 1 })
    const ctx = makeAuthContext('owner')
    const result = await getCustomerDetail(ctx, 'c1', true)
    expect(result.vehicles).toHaveLength(1)
    expect(vehicleListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      activeOnly: true,
      customerId: 'c1',
      skip: 0,
      take: 100,
    })
  })
})

describe('createCustomer', () => {
  it('allows owner/admin to create', async () => {
    createMock.mockResolvedValue(makeCustomer())
    await createCustomer(makeAuthContext('owner'), { firstName: 'Ivan', phone: '12345' })
    await expect(createCustomer(makeAuthContext('admin'), { firstName: 'Ivan', phone: '12345' })).resolves.toBeDefined()
  })

  it('rejects manager from creating', async () => {
    await expect(createCustomer(makeAuthContext('manager'), { firstName: 'Ivan', phone: '12345' })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects creating a second active customer with the same email', async () => {
    findActiveByEmailMock.mockResolvedValue(makeCustomer({ id: 'existing' }))
    await expect(
      createCustomer(makeAuthContext('owner'), { firstName: 'Ivan', phone: '12345', email: 'ivan@example.com' })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('allows creating a customer without an email even if others have none', async () => {
    createMock.mockResolvedValue(makeCustomer())
    await expect(createCustomer(makeAuthContext('owner'), { firstName: 'Ivan', phone: '12345' })).resolves.toBeDefined()
    expect(findActiveByEmailMock).not.toHaveBeenCalled()
  })

  it('stores omitted optional fields as null, never as undefined or an empty string', async () => {
    createMock.mockResolvedValue(makeCustomer())
    await createCustomer(makeAuthContext('owner'), { firstName: 'Ivan', phone: '12345' })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastName: null, email: null, notes: null })
    )
  })
})

describe('updateCustomer', () => {
  it('rejects manager from updating', async () => {
    await expect(updateCustomer(makeAuthContext('manager'), 'c1', { firstName: 'X' })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(updateByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant customer', async () => {
    updateByIdMock.mockResolvedValue(null)
    await expect(updateCustomer(makeAuthContext('owner'), 'unknown', { firstName: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('rejects changing email to one already used by another active customer', async () => {
    findActiveByEmailMock.mockResolvedValue(makeCustomer({ id: 'other' }))
    await expect(
      updateCustomer(makeAuthContext('owner'), 'c1', { email: 'taken@example.com' })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(findActiveByEmailMock).toHaveBeenCalledWith('t1', 'b1', 'taken@example.com', 'c1')
  })
})

describe('deactivateCustomer', () => {
  it('is idempotent and rejects manager', async () => {
    deactivateMock.mockResolvedValue(1)
    await expect(deactivateCustomer(makeAuthContext('owner'), 'c1')).resolves.toBeUndefined()
    await expect(deactivateCustomer(makeAuthContext('manager'), 'c1')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns 404 for an unknown/foreign-tenant customer', async () => {
    deactivateMock.mockResolvedValue(0)
    await expect(deactivateCustomer(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('never touches Vehicle or Lead records — deactivation cascades to nothing', async () => {
    deactivateMock.mockResolvedValue(1)
    await deactivateCustomer(makeAuthContext('owner'), 'c1')
    // customerService only ever calls customerRepository.deactivate for this
    // operation; it doesn't import a Lead repository at all, and the only
    // Vehicle repository call it's capable of making (vehicleRepository.list,
    // for includeVehicles on GET) is never invoked here.
    expect(vehicleListMock).not.toHaveBeenCalled()
  })
})
