import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  businessFindManyMock,
  businessFindFirstMock,
  businessUpdateManyMock,
  serviceFindManyMock,
  serviceFindFirstMock,
  serviceUpdateManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  businessFindManyMock: vi.fn(),
  businessFindFirstMock: vi.fn(),
  businessUpdateManyMock: vi.fn(),
  serviceFindManyMock: vi.fn(),
  serviceFindFirstMock: vi.fn(),
  serviceUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock('../src/server/db/prisma', () => ({
  prisma: {
    business: { findMany: businessFindManyMock, findFirst: businessFindFirstMock, updateMany: businessUpdateManyMock },
    service: { findMany: serviceFindManyMock, findFirst: serviceFindFirstMock, updateMany: serviceUpdateManyMock },
    businessWorkingHours: { upsert: vi.fn((args: unknown) => args) },
    $transaction: transactionMock,
  },
}))

import { businessRepository } from '../src/server/repositories/businessRepository'
import { serviceRepository } from '../src/server/repositories/serviceRepository'
import { workingHoursRepository } from '../src/server/repositories/workingHoursRepository'

beforeEach(() => {
  vi.clearAllMocks()
  businessFindManyMock.mockResolvedValue([])
  businessFindFirstMock.mockResolvedValue(null)
  businessUpdateManyMock.mockResolvedValue({ count: 0 })
  serviceFindManyMock.mockResolvedValue([])
  serviceFindFirstMock.mockResolvedValue(null)
  serviceUpdateManyMock.mockResolvedValue({ count: 0 })
})

describe('tenant isolation — Business', () => {
  it('always scopes business list queries to the requesting tenant', async () => {
    await businessRepository.listByTenant('tenant-a')
    expect(businessFindManyMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })

  it('never lets tenant A read data scoped to tenant B', async () => {
    await businessRepository.listByTenant('tenant-a')
    const callArgs = businessFindManyMock.mock.calls[0]![0] as { where: { tenantId: string } }
    expect(callArgs.where.tenantId).toBe('tenant-a')
    expect(callArgs.where.tenantId).not.toBe('tenant-b')
  })

  it('scopes single-record lookups to the requesting tenant too', async () => {
    await businessRepository.findFirstByTenant('tenant-a')
    expect(businessFindFirstMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a' } })
  })

  it('Test 4 — tenant A cannot update tenant B business: updateMany is scoped by tenantId + id together', async () => {
    businessUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await businessRepository.update('tenant-a', 'business-owned-by-tenant-b', { name: 'Hijacked' })

    expect(businessUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'business-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { name: 'Hijacked' },
    })
    // 0 rows matched because the id belongs to a different tenant -> repository reports "not found", not success.
    expect(result).toBeNull()
  })
})

describe('tenant isolation — Service', () => {
  it('Test 1 — tenant A service cannot be read by tenant B (query is scoped, so it simply never matches)', async () => {
    serviceFindFirstMock.mockResolvedValue(null)
    const result = await serviceRepository.findById('tenant-b', 'business-b', 'service-owned-by-tenant-a')

    expect(serviceFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'service-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B service: updateMany is scoped by tenantId + businessId + id', async () => {
    serviceUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await serviceRepository.updateById('tenant-a', 'business-a', 'service-owned-by-tenant-b', { name: 'X' })

    expect(serviceUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'service-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { name: 'X' },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B service: 0 rows matched, not a silent success', async () => {
    serviceUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await serviceRepository.deactivate('tenant-a', 'business-a', 'service-owned-by-tenant-b')

    expect(serviceUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'service-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

  it('list queries are always scoped to both tenantId and businessId', async () => {
    await serviceRepository.listByBusiness('tenant-a', 'business-a', true)
    expect(serviceFindManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', isActive: true, tenantId: 'tenant-a' },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('tenant isolation — Working hours', () => {
  it('Test 5 — replacing the schedule only ever touches the given businessId (there is no tenant-supplied override)', async () => {
    const days = [{ dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' }] as never
    await workingHoursRepository.replaceAll('business-a', days)

    expect(transactionMock).toHaveBeenCalledTimes(1)
    const ops = transactionMock.mock.calls[0]![0] as Array<{ where: { businessId_dayOfWeek: { businessId: string } } }>
    expect(ops.every((op) => op.where.businessId_dayOfWeek.businessId === 'business-a')).toBe(true)
  })
})
