import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listByBusinessMock, findByIdMock, createMock, updateByIdMock, deactivateMock } = vi.hoisted(() => ({
  listByBusinessMock: vi.fn(),
  findByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateByIdMock: vi.fn(),
  deactivateMock: vi.fn(),
}))

vi.mock('../src/server/repositories/businessRuleRepository', () => ({
  businessRuleRepository: {
    listByBusiness: listByBusinessMock,
    findById: findByIdMock,
    create: createMock,
    updateById: updateByIdMock,
    deactivate: deactivateMock,
  },
}))

import {
  listBusinessRules,
  getBusinessRule,
  createBusinessRule,
  updateBusinessRule,
  deactivateBusinessRule,
} from '../src/server/services/businessRuleService'

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    tenantId: 't1',
    businessId: 'b1',
    name: 'Rule',
    description: 'Description',
    category: 'GENERAL',
    priority: 50,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listBusinessRules', () => {
  it('scopes to the current tenant and business, any authenticated role', async () => {
    listByBusinessMock.mockResolvedValue([])
    const ctx = makeAuthContext('manager')
    await listBusinessRules(ctx, { activeOnly: true })
    expect(listByBusinessMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: true })
  })

  it('returns rules pre-sorted by the repository (priority asc, then createdAt asc)', async () => {
    const sorted = [makeRule({ id: 'r-high', priority: 10 }), makeRule({ id: 'r-low', priority: 90 })]
    listByBusinessMock.mockResolvedValue(sorted)
    const ctx = makeAuthContext('owner')
    const result = await listBusinessRules(ctx, { activeOnly: true })
    expect(result[0]!.id).toBe('r-high')
    expect(result[1]!.id).toBe('r-low')
  })
})

describe('getBusinessRule', () => {
  it('returns the rule when found', async () => {
    findByIdMock.mockResolvedValue(makeRule())
    const result = await getBusinessRule(makeAuthContext('manager'), 'r1')
    expect(result.id).toBe('r1')
  })

  it('returns 404 for an unknown id', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(getBusinessRule(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  })

  it('returns 404 for a foreign-tenant rule — the repo itself is scoped', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctxB = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-b' },
      business: { ...makeAuthContext().business, id: 'business-b', tenantId: 'tenant-b' },
    })
    await expect(getBusinessRule(ctxB, 'rule-owned-by-tenant-a')).rejects.toMatchObject({ statusCode: 404 })
    expect(findByIdMock).toHaveBeenCalledWith('tenant-b', 'business-b', 'rule-owned-by-tenant-a')
  })
})

describe('createBusinessRule', () => {
  it('allows owner to create', async () => {
    createMock.mockResolvedValue(makeRule())
    const ctx = makeAuthContext('owner')
    await createBusinessRule(ctx, { name: 'N', description: 'D', category: 'GENERAL' as never, priority: 50 })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, name: 'N', priority: 50 })
    )
  })

  it('allows admin to create', async () => {
    createMock.mockResolvedValue(makeRule())
    const ctx = makeAuthContext('admin')
    await expect(
      createBusinessRule(ctx, { name: 'N', description: 'D', category: 'GENERAL' as never, priority: 50 })
    ).resolves.toBeDefined()
  })

  it('rejects manager from creating', async () => {
    const ctx = makeAuthContext('manager')
    await expect(
      createBusinessRule(ctx, { name: 'N', description: 'D', category: 'GENERAL' as never, priority: 50 })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('updateBusinessRule', () => {
  it('allows owner to update', async () => {
    updateByIdMock.mockResolvedValue(makeRule({ priority: 5 }))
    const result = await updateBusinessRule(makeAuthContext('owner'), 'r1', { priority: 5 })
    expect(result.priority).toBe(5)
  })

  it('rejects manager from updating', async () => {
    const ctx = makeAuthContext('manager')
    await expect(updateBusinessRule(ctx, 'r1', { priority: 5 })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant rule', async () => {
    updateByIdMock.mockResolvedValue(null)
    await expect(updateBusinessRule(makeAuthContext('owner'), 'unknown', { priority: 5 })).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('deactivateBusinessRule', () => {
  it('allows owner/admin and is idempotent', async () => {
    deactivateMock.mockResolvedValue(1)
    await expect(deactivateBusinessRule(makeAuthContext('owner'), 'r1')).resolves.toBeUndefined()
    await expect(deactivateBusinessRule(makeAuthContext('admin'), 'r1')).resolves.toBeUndefined()
  })

  it('rejects manager', async () => {
    const ctx = makeAuthContext('manager')
    await expect(deactivateBusinessRule(ctx, 'r1')).rejects.toMatchObject({ statusCode: 403 })
    expect(deactivateMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant rule', async () => {
    deactivateMock.mockResolvedValue(0)
    await expect(deactivateBusinessRule(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('always scopes the deactivate call to the current tenant/business', async () => {
    deactivateMock.mockResolvedValue(1)
    const ctx = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-a' },
      business: { ...makeAuthContext().business, id: 'business-a', tenantId: 'tenant-a' },
    })
    await deactivateBusinessRule(ctx, 'r1')
    expect(deactivateMock).toHaveBeenCalledWith('tenant-a', 'business-a', 'r1')
  })
})
