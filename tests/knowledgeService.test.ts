import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { listByBusinessMock, findByIdMock, createMock, updateByIdMock, deactivateMock } = vi.hoisted(() => ({
  listByBusinessMock: vi.fn(),
  findByIdMock: vi.fn(),
  createMock: vi.fn(),
  updateByIdMock: vi.fn(),
  deactivateMock: vi.fn(),
}))

vi.mock('../src/server/repositories/knowledgeRepository', () => ({
  knowledgeRepository: {
    listByBusiness: listByBusinessMock,
    findById: findByIdMock,
    create: createMock,
    updateById: updateByIdMock,
    deactivate: deactivateMock,
  },
}))

import {
  listKnowledgeItems,
  getKnowledgeItem,
  createKnowledgeItem,
  updateKnowledgeItem,
  deactivateKnowledgeItem,
} from '../src/server/services/knowledgeService'

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    tenantId: 't1',
    businessId: 'b1',
    title: 'FAQ item',
    content: 'Some content',
    category: 'GENERAL',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listKnowledgeItems', () => {
  it('scopes to the current tenant and business, any authenticated role', async () => {
    listByBusinessMock.mockResolvedValue([])
    const ctx = makeAuthContext('manager')
    await listKnowledgeItems(ctx, { activeOnly: true })
    expect(listByBusinessMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: true })
  })

  it('passes the category filter through', async () => {
    listByBusinessMock.mockResolvedValue([])
    const ctx = makeAuthContext('owner')
    await listKnowledgeItems(ctx, { activeOnly: false, category: 'PAYMENT' as never })
    expect(listByBusinessMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: false, category: 'PAYMENT' })
  })
})

describe('getKnowledgeItem', () => {
  it('returns the item when found', async () => {
    findByIdMock.mockResolvedValue(makeItem())
    const ctx = makeAuthContext('manager')
    const result = await getKnowledgeItem(ctx, 'k1')
    expect(result.id).toBe('k1')
  })

  it('returns 404 for an unknown id', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(getKnowledgeItem(ctx, 'unknown')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  it('returns 404 (not the item) for a foreign-tenant item — the repo itself is scoped', async () => {
    findByIdMock.mockResolvedValue(null)
    const ctxB = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-b' },
      business: { ...makeAuthContext().business, id: 'business-b', tenantId: 'tenant-b' },
    })
    await expect(getKnowledgeItem(ctxB, 'item-owned-by-tenant-a')).rejects.toMatchObject({ statusCode: 404 })
    expect(findByIdMock).toHaveBeenCalledWith('tenant-b', 'business-b', 'item-owned-by-tenant-a')
  })
})

describe('createKnowledgeItem', () => {
  it('allows owner to create', async () => {
    createMock.mockResolvedValue(makeItem())
    const ctx = makeAuthContext('owner')
    await createKnowledgeItem(ctx, { title: 'T', content: 'C', category: 'GENERAL' as never })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, title: 'T', content: 'C' })
    )
  })

  it('allows admin to create', async () => {
    createMock.mockResolvedValue(makeItem())
    const ctx = makeAuthContext('admin')
    await expect(createKnowledgeItem(ctx, { title: 'T', content: 'C', category: 'GENERAL' as never })).resolves.toBeDefined()
  })

  it('rejects manager from creating', async () => {
    const ctx = makeAuthContext('manager')
    await expect(
      createKnowledgeItem(ctx, { title: 'T', content: 'C', category: 'GENERAL' as never })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('updateKnowledgeItem', () => {
  it('allows owner to update', async () => {
    updateByIdMock.mockResolvedValue(makeItem({ title: 'New' }))
    const ctx = makeAuthContext('owner')
    const result = await updateKnowledgeItem(ctx, 'k1', { title: 'New' })
    expect(result.title).toBe('New')
  })

  it('rejects manager from updating', async () => {
    const ctx = makeAuthContext('manager')
    await expect(updateKnowledgeItem(ctx, 'k1', { title: 'New' })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant item', async () => {
    updateByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(updateKnowledgeItem(ctx, 'unknown', { title: 'New' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deactivateKnowledgeItem', () => {
  it('allows owner/admin and is idempotent', async () => {
    deactivateMock.mockResolvedValue(1)
    await expect(deactivateKnowledgeItem(makeAuthContext('owner'), 'k1')).resolves.toBeUndefined()
    await expect(deactivateKnowledgeItem(makeAuthContext('admin'), 'k1')).resolves.toBeUndefined()
  })

  it('rejects manager', async () => {
    const ctx = makeAuthContext('manager')
    await expect(deactivateKnowledgeItem(ctx, 'k1')).rejects.toMatchObject({ statusCode: 403 })
    expect(deactivateMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant item', async () => {
    deactivateMock.mockResolvedValue(0)
    const ctx = makeAuthContext('owner')
    await expect(deactivateKnowledgeItem(ctx, 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('always scopes the deactivate call to the current tenant/business', async () => {
    deactivateMock.mockResolvedValue(1)
    const ctx = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-a' },
      business: { ...makeAuthContext().business, id: 'business-a', tenantId: 'tenant-a' },
    })
    await deactivateKnowledgeItem(ctx, 'k1')
    expect(deactivateMock).toHaveBeenCalledWith('tenant-a', 'business-a', 'k1')
  })
})
