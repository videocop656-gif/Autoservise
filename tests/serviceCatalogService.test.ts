import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listByBusinessMock, findByIdMock, createMock, updateByIdMock, deactivateMock } = vi.hoisted(() => ({
  listByBusinessMock: vi.fn(),
  findByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateByIdMock: vi.fn(),
  deactivateMock: vi.fn(),
}))

vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: {
    listByBusiness: listByBusinessMock,
    findById: findByIdMock,
    create: createMock,
    updateById: updateByIdMock,
    deactivate: deactivateMock,
  },
}))

import { listServices, getService, createService, updateService, deactivateService } from '../src/server/services/serviceCatalogService'

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    tenantId: 't1',
    businessId: 'b1',
    name: 'Oil change',
    description: null,
    priceFrom: { toNumber: () => 1000 },
    priceTo: { toNumber: () => 2000 },
    currency: 'RUB',
    durationMinutes: 30,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listServices', () => {
  it('scopes to the current tenant and business', async () => {
    listByBusinessMock.mockResolvedValue([])
    const ctx = makeAuthContext('manager')
    await listServices(ctx, true)
    expect(listByBusinessMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, true)
  })

  it('manager can list active services (no role restriction on read)', async () => {
    listByBusinessMock.mockResolvedValue([makeService()])
    const ctx = makeAuthContext('manager')
    const result = await listServices(ctx, true)
    expect(result).toHaveLength(1)
  })

  it('can list inactive services when explicitly requested', async () => {
    listByBusinessMock.mockResolvedValue([makeService({ isActive: false })])
    const ctx = makeAuthContext('owner')
    await listServices(ctx, false)
    expect(listByBusinessMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, false)
  })
})

describe('getService', () => {
  it('returns the service when it belongs to the current tenant/business', async () => {
    findByIdMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('manager')
    const result = await getService(ctx, 's1')
    expect(result.id).toBe('s1')
  })

  it('returns 404 for an unknown service id', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(getService(ctx, 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 404 (not the service) for a service belonging to a foreign tenant', async () => {
    // The repository itself is tenant-scoped, so a foreign-tenant service
    // simply never matches — findById correctly returns null for it.
    findByIdMock.mockResolvedValue(null)
    const ctxTenantB = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-b' },
      business: { ...makeAuthContext().business, id: 'business-b', tenantId: 'tenant-b' },
    })

    await expect(getService(ctxTenantB, 'service-owned-by-tenant-a')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
    expect(findByIdMock).toHaveBeenCalledWith('tenant-b', 'business-b', 'service-owned-by-tenant-a')
  })
})

describe('createService', () => {
  it('allows owner to create a service, defaulting currency from the business', async () => {
    createMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('owner')

    await createService(ctx, { name: 'Oil change', durationMinutes: 30 })

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, currency: ctx.business.currency })
    )
  })

  it('allows admin to create a service', async () => {
    createMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('admin')
    await expect(createService(ctx, { name: 'Oil change', durationMinutes: 30 })).resolves.toBeDefined()
  })

  it('rejects manager from creating a service', async () => {
    const ctx = makeAuthContext('manager')
    await expect(createService(ctx, { name: 'Oil change', durationMinutes: 30 })).rejects.toMatchObject({ statusCode: 403 })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('uses an explicitly provided currency instead of the business default', async () => {
    createMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('owner')
    await createService(ctx, { name: 'Oil change', durationMinutes: 30, currency: 'USD' })
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' }))
  })
})

describe('updateService', () => {
  it('allows owner to update a service', async () => {
    findByIdMock.mockResolvedValue(makeService())
    updateByIdMock.mockResolvedValue(makeService({ name: 'New name' }))
    const ctx = makeAuthContext('owner')

    const result = await updateService(ctx, 's1', { name: 'New name' })
    expect(result.name).toBe('New name')
  })

  it('allows admin to update a service', async () => {
    findByIdMock.mockResolvedValue(makeService())
    updateByIdMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('admin')
    await expect(updateService(ctx, 's1', { isActive: false })).resolves.toBeDefined()
  })

  it('rejects manager from updating a service', async () => {
    const ctx = makeAuthContext('manager')
    await expect(updateService(ctx, 's1', { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
    expect(findByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown service', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(updateService(ctx, 'unknown', { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 404 for a service belonging to a foreign tenant', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(updateService(ctx, 'foreign-service', { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects updating priceTo below the existing priceFrom when priceFrom is not part of this update', async () => {
    findByIdMock.mockResolvedValue(makeService({ priceFrom: { toNumber: () => 1000 }, priceTo: { toNumber: () => 2000 } }))
    const ctx = makeAuthContext('owner')

    await expect(updateService(ctx, 's1', { priceTo: 500 })).rejects.toMatchObject({ statusCode: 400 })
    expect(updateByIdMock).not.toHaveBeenCalled()
  })

  it('allows updating priceFrom below the existing priceTo', async () => {
    findByIdMock.mockResolvedValue(makeService({ priceFrom: { toNumber: () => 1000 }, priceTo: { toNumber: () => 2000 } }))
    updateByIdMock.mockResolvedValue(makeService())
    const ctx = makeAuthContext('owner')

    await expect(updateService(ctx, 's1', { priceFrom: 500 })).resolves.toBeDefined()
  })
})

describe('deactivateService', () => {
  it('allows owner to deactivate a service', async () => {
    deactivateMock.mockResolvedValue(1)
    const ctx = makeAuthContext('owner')
    await expect(deactivateService(ctx, 's1')).resolves.toBeUndefined()
  })

  it('allows admin to deactivate a service', async () => {
    deactivateMock.mockResolvedValue(1)
    const ctx = makeAuthContext('admin')
    await expect(deactivateService(ctx, 's1')).resolves.toBeUndefined()
  })

  it('rejects manager from deactivating a service', async () => {
    const ctx = makeAuthContext('manager')
    await expect(deactivateService(ctx, 's1')).rejects.toMatchObject({ statusCode: 403 })
    expect(deactivateMock).not.toHaveBeenCalled()
  })

  it('is idempotent: deactivating an already-inactive service still succeeds', async () => {
    deactivateMock.mockResolvedValue(1) // repository reports a match regardless of prior isActive value
    const ctx = makeAuthContext('owner')
    await expect(deactivateService(ctx, 's1')).resolves.toBeUndefined()
  })

  it('returns 404 for an unknown/foreign-tenant service instead of silently succeeding', async () => {
    deactivateMock.mockResolvedValue(0)
    const ctx = makeAuthContext('owner')
    await expect(deactivateService(ctx, 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('always scopes the deactivate call to the current tenant and business, never a client-supplied one', async () => {
    deactivateMock.mockResolvedValue(1)
    const ctx = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-a' },
      business: { ...makeAuthContext().business, id: 'business-a', tenantId: 'tenant-a' },
    })
    await deactivateService(ctx, 's1')
    expect(deactivateMock).toHaveBeenCalledWith('tenant-a', 'business-a', 's1')
  })
})
