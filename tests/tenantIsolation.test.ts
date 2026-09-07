import { describe, it, expect, vi, beforeEach } from 'vitest'

const { findManyMock, findFirstMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findFirstMock: vi.fn(),
}))

vi.mock('../src/server/db/prisma', () => ({
  prisma: {
    business: { findMany: findManyMock, findFirst: findFirstMock },
  },
}))

import { businessRepository } from '../src/server/repositories/businessRepository'

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([])
  findFirstMock.mockReset().mockResolvedValue(null)
})

describe('tenant isolation', () => {
  it('always scopes business list queries to the requesting tenant', async () => {
    await businessRepository.listByTenant('tenant-a')
    expect(findManyMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })

  it('never lets tenant A read data scoped to tenant B', async () => {
    await businessRepository.listByTenant('tenant-a')
    const callArgs = findManyMock.mock.calls[0]![0] as { where: { tenantId: string } }
    expect(callArgs.where.tenantId).toBe('tenant-a')
    expect(callArgs.where.tenantId).not.toBe('tenant-b')
  })

  it('scopes single-record lookups to the requesting tenant too', async () => {
    await businessRepository.findFirstByTenant('tenant-a')
    expect(findFirstMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })
})
