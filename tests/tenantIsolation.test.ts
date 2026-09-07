import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  businessFindManyMock,
  businessFindFirstMock,
  businessUpdateManyMock,
  serviceFindManyMock,
  serviceFindFirstMock,
  serviceUpdateManyMock,
  knowledgeFindFirstMock,
  knowledgeUpdateManyMock,
  ruleFindFirstMock,
  ruleUpdateManyMock,
  customerFindFirstMock,
  customerUpdateManyMock,
  vehicleFindFirstMock,
  vehicleUpdateManyMock,
  leadFindFirstMock,
  leadUpdateManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  businessFindManyMock: vi.fn(),
  businessFindFirstMock: vi.fn(),
  businessUpdateManyMock: vi.fn(),
  serviceFindManyMock: vi.fn(),
  serviceFindFirstMock: vi.fn(),
  serviceUpdateManyMock: vi.fn(),
  knowledgeFindFirstMock: vi.fn(),
  knowledgeUpdateManyMock: vi.fn(),
  ruleFindFirstMock: vi.fn(),
  ruleUpdateManyMock: vi.fn(),
  customerFindFirstMock: vi.fn(),
  customerUpdateManyMock: vi.fn(),
  vehicleFindFirstMock: vi.fn(),
  vehicleUpdateManyMock: vi.fn(),
  leadFindFirstMock: vi.fn(),
  leadUpdateManyMock: vi.fn(),
  transactionMock: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock('../src/server/db/prisma', () => ({
  prisma: {
    business: { findMany: businessFindManyMock, findFirst: businessFindFirstMock, updateMany: businessUpdateManyMock },
    service: { findMany: serviceFindManyMock, findFirst: serviceFindFirstMock, updateMany: serviceUpdateManyMock },
    knowledgeItem: { findFirst: knowledgeFindFirstMock, updateMany: knowledgeUpdateManyMock },
    businessRule: { findFirst: ruleFindFirstMock, updateMany: ruleUpdateManyMock },
    customer: { findFirst: customerFindFirstMock, updateMany: customerUpdateManyMock },
    vehicle: { findFirst: vehicleFindFirstMock, updateMany: vehicleUpdateManyMock },
    lead: { findFirst: leadFindFirstMock, updateMany: leadUpdateManyMock },
    businessWorkingHours: { upsert: vi.fn((args: unknown) => args) },
    $transaction: transactionMock,
  },
}))

import { businessRepository } from '../src/server/repositories/businessRepository'
import { serviceRepository } from '../src/server/repositories/serviceRepository'
import { workingHoursRepository } from '../src/server/repositories/workingHoursRepository'
import { knowledgeRepository } from '../src/server/repositories/knowledgeRepository'
import { businessRuleRepository } from '../src/server/repositories/businessRuleRepository'
import { customerRepository } from '../src/server/repositories/customerRepository'
import { vehicleRepository } from '../src/server/repositories/vehicleRepository'
import { leadRepository } from '../src/server/repositories/leadRepository'

beforeEach(() => {
  vi.clearAllMocks()
  businessFindManyMock.mockResolvedValue([])
  businessFindFirstMock.mockResolvedValue(null)
  businessUpdateManyMock.mockResolvedValue({ count: 0 })
  serviceFindManyMock.mockResolvedValue([])
  serviceFindFirstMock.mockResolvedValue(null)
  serviceUpdateManyMock.mockResolvedValue({ count: 0 })
  knowledgeFindFirstMock.mockResolvedValue(null)
  knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
  ruleFindFirstMock.mockResolvedValue(null)
  ruleUpdateManyMock.mockResolvedValue({ count: 0 })
  customerFindFirstMock.mockResolvedValue(null)
  customerUpdateManyMock.mockResolvedValue({ count: 0 })
  vehicleFindFirstMock.mockResolvedValue(null)
  vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
  leadFindFirstMock.mockResolvedValue(null)
  leadUpdateManyMock.mockResolvedValue({ count: 0 })
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

describe('tenant isolation — Knowledge base', () => {
  it('Test 1 — tenant A knowledge item cannot be read by tenant B', async () => {
    knowledgeFindFirstMock.mockResolvedValue(null)
    const result = await knowledgeRepository.findById('tenant-b', 'business-b', 'item-owned-by-tenant-a')

    expect(knowledgeFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'item-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B knowledge item', async () => {
    knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await knowledgeRepository.updateById('tenant-a', 'business-a', 'item-owned-by-tenant-b', { title: 'X' })

    expect(knowledgeUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'item-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { title: 'X' },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B knowledge item', async () => {
    knowledgeUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await knowledgeRepository.deactivate('tenant-a', 'business-a', 'item-owned-by-tenant-b')

    expect(knowledgeUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'item-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })
})

describe('tenant isolation — Business rules', () => {
  it('Test 1 — tenant A rule cannot be read by tenant B', async () => {
    ruleFindFirstMock.mockResolvedValue(null)
    const result = await businessRuleRepository.findById('tenant-b', 'business-b', 'rule-owned-by-tenant-a')

    expect(ruleFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'rule-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('Test 2 — tenant A cannot update tenant B rule', async () => {
    ruleUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await businessRuleRepository.updateById('tenant-a', 'business-a', 'rule-owned-by-tenant-b', { priority: 1 })

    expect(ruleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'rule-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { priority: 1 },
    })
    expect(result).toBeNull()
  })

  it('Test 3 — tenant A cannot deactivate tenant B rule', async () => {
    ruleUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await businessRuleRepository.deactivate('tenant-a', 'business-a', 'rule-owned-by-tenant-b')

    expect(ruleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', id: 'rule-owned-by-tenant-b', tenantId: 'tenant-a' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })
})

describe('tenant isolation — Customer', () => {
  it('tenant B cannot GET tenant A customer', async () => {
    customerFindFirstMock.mockResolvedValue(null)
    const result = await customerRepository.findById('tenant-b', 'business-b', 'customer-owned-by-tenant-a')

    expect(customerFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A customer', async () => {
    customerUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await customerRepository.updateById('tenant-b', 'business-b', 'customer-owned-by-tenant-a', {
      firstName: 'Hijacked',
    })

    expect(customerUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { firstName: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot DELETE (deactivate) tenant A customer', async () => {
    customerUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await customerRepository.deactivate('tenant-b', 'business-b', 'customer-owned-by-tenant-a')

    expect(customerUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'customer-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

  it('email-duplicate lookups are scoped to the requesting tenant/business', async () => {
    await customerRepository.findActiveByEmail('tenant-a', 'business-a', 'a@b.com')
    expect(customerFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-a', email: 'a@b.com', isActive: true, tenantId: 'tenant-a' },
    })
  })
})

describe('tenant isolation — Vehicle', () => {
  it('tenant B cannot GET tenant A vehicle', async () => {
    vehicleFindFirstMock.mockResolvedValue(null)
    const result = await vehicleRepository.findById('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a')

    expect(vehicleFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A vehicle', async () => {
    vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await vehicleRepository.updateById('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a', {
      make: 'Hijacked',
    })

    expect(vehicleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { make: 'Hijacked' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot DELETE (deactivate) tenant A vehicle', async () => {
    vehicleUpdateManyMock.mockResolvedValue({ count: 0 })
    const count = await vehicleRepository.deactivate('tenant-b', 'business-b', 'vehicle-owned-by-tenant-a')

    expect(vehicleUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'vehicle-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { isActive: false },
    })
    expect(count).toBe(0)
  })

})

describe('tenant isolation — Lead', () => {
  it('tenant B cannot GET tenant A lead', async () => {
    leadFindFirstMock.mockResolvedValue(null)
    const result = await leadRepository.findById('tenant-b', 'business-b', 'lead-owned-by-tenant-a')

    expect(leadFindFirstMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'lead-owned-by-tenant-a', tenantId: 'tenant-b' },
    })
    expect(result).toBeNull()
  })

  it('tenant B cannot PATCH tenant A lead', async () => {
    leadUpdateManyMock.mockResolvedValue({ count: 0 })
    const result = await leadRepository.updateById('tenant-b', 'business-b', 'lead-owned-by-tenant-a', {
      subject: 'Hijacked',
    })

    expect(leadUpdateManyMock).toHaveBeenCalledWith({
      where: { businessId: 'business-b', id: 'lead-owned-by-tenant-a', tenantId: 'tenant-b' },
      data: { subject: 'Hijacked' },
    })
    expect(result).toBeNull()
  })
})
