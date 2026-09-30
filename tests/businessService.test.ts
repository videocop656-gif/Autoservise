import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'

const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }))

vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { update: updateMock },
}))

import { updateBusinessProfile } from '../src/server/services/businessService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('updateBusinessProfile', () => {
  it('allows owner to update the business', async () => {
    updateMock.mockResolvedValue(makeBusiness({ name: 'New Name' }))
    const ctx = makeAuthContext('owner')

    const result = await updateBusinessProfile(ctx, { name: 'New Name' })

    expect(result.name).toBe('New Name')
    expect(updateMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { name: 'New Name' })
  })

  it('allows admin to update the business', async () => {
    updateMock.mockResolvedValue(makeBusiness({ name: 'New Name' }))
    const ctx = makeAuthContext('admin')

    await expect(updateBusinessProfile(ctx, { name: 'New Name' })).resolves.toBeDefined()
  })

  it('rejects manager from updating the business', async () => {
    const ctx = makeAuthContext('manager')

    await expect(updateBusinessProfile(ctx, { name: 'New Name' })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('scopes the update to the current tenant and business (never a client-supplied id)', async () => {
    updateMock.mockResolvedValue(makeBusiness())
    const ctx = makeAuthContext('owner', {
      tenant: { ...makeAuthContext().tenant, id: 'tenant-a' },
      business: makeBusiness({ id: 'business-a', tenantId: 'tenant-a' }),
    })

    await updateBusinessProfile(ctx, { name: 'X' })

    expect(updateMock).toHaveBeenCalledWith('tenant-a', 'business-a', { name: 'X' })
  })

  it('surfaces a 404 if the business no longer matches the tenant (e.g. cross-tenant attempt)', async () => {
    updateMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')

    await expect(updateBusinessProfile(ctx, { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// Prompt 50 — Количество постов is part of the business profile.
describe('updateBusinessProfile — serviceBayCapacity', () => {
  it('owner/admin can set it; it is written for the session business only', async () => {
    updateMock.mockResolvedValue(makeBusiness({ serviceBayCapacity: 3 }))
    const ctx = makeAuthContext('admin')

    const result = await updateBusinessProfile(ctx, { serviceBayCapacity: 3 })

    expect(result.serviceBayCapacity).toBe(3)
    expect(updateMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { serviceBayCapacity: 3 })
  })

  it('a manager cannot change it (403, nothing written)', async () => {
    await expect(updateBusinessProfile(makeAuthContext('manager'), { serviceBayCapacity: 3 })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('is exposed on the business DTO (what GET /api/business and /api/auth/me return)', async () => {
    const { toBusinessDto } = await import('../src/server/lib/dto')
    expect(toBusinessDto(makeBusiness({ serviceBayCapacity: 4 })).serviceBayCapacity).toBe(4)
  })
})
