import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const {
  serviceListMock,
  knowledgeListMock,
  ruleListMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  customerRequestFindByIdMock,
} = vi.hoisted(() => ({
  serviceListMock: vi.fn(),
  knowledgeListMock: vi.fn(),
  ruleListMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  customerRequestFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: { listByBusiness: serviceListMock },
}))
vi.mock('../src/server/repositories/knowledgeRepository', () => ({
  knowledgeRepository: { listByBusiness: knowledgeListMock },
}))
vi.mock('../src/server/repositories/businessRuleRepository', () => ({
  businessRuleRepository: { listByBusiness: ruleListMock },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: customerFindByIdMock },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: { findById: vehicleFindByIdMock },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: { findById: customerRequestFindByIdMock },
}))

import { buildAiContext } from '../src/server/ai/contextBuilder'

function makeDecimal(value: string) {
  return { toFixed: () => value }
}

beforeEach(() => {
  vi.clearAllMocks()
  serviceListMock.mockResolvedValue([
    { name: 'Замена масла', description: 'desc', priceFrom: makeDecimal('1500.00'), priceTo: makeDecimal('2500.00'), currency: 'RUB', durationMinutes: 60 },
  ])
  knowledgeListMock.mockResolvedValue([{ title: 'FAQ', content: 'content', category: 'FAQ' }])
  ruleListMock.mockResolvedValue([{ name: 'Rule 1', description: 'desc', category: 'GENERAL', priority: 50 }])
  customerFindByIdMock.mockResolvedValue(null)
  vehicleFindByIdMock.mockResolvedValue(null)
  customerRequestFindByIdMock.mockResolvedValue(null)
})

describe('buildAiContext', () => {
  it('always includes business fields, never internal ids', async () => {
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
    expect(context.business).toEqual({
      name: ctx.business.name,
      description: ctx.business.description,
      phone: ctx.business.phone,
      email: ctx.business.email,
      address: ctx.business.address,
      timezone: ctx.business.timezone,
      currency: ctx.business.currency,
    })
    expect(JSON.stringify(context)).not.toContain(ctx.tenant.id)
    expect(JSON.stringify(context)).not.toContain(ctx.business.id)
  })

  it('requests only active services/knowledge/rules', async () => {
    const ctx = makeAuthContext('owner')
    await buildAiContext(ctx, { customerId: null, customerRequestId: null })
    expect(serviceListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, true)
    expect(knowledgeListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: true })
    expect(ruleListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { activeOnly: true })
  })

  it('serializes services with fixed-point price strings, never raw Decimal objects', async () => {
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
    expect(context.services).toEqual([
      { name: 'Замена масла', description: 'desc', priceFrom: '1500.00', priceTo: '2500.00', currency: 'RUB', durationMinutes: 60 },
    ])
  })

  it('includes the customer when the conversation has one, scoped to tenant/business', async () => {
    customerFindByIdMock.mockResolvedValue({
      id: 'cust1',
      firstName: 'Ivan',
      lastName: 'Petrov',
      phone: '+79001234567',
      email: null,
      notes: 'this must never leak',
      isActive: true,
    })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: null })
    expect(customerFindByIdMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'cust1')
    expect(context.customer).toEqual({ firstName: 'Ivan', lastName: 'Petrov', phone: '+79001234567', email: null })
    expect(JSON.stringify(context)).not.toContain('never leak')
  })

  it('leaves customer null when the conversation has none', async () => {
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
    expect(context.customer).toBeNull()
    expect(customerFindByIdMock).not.toHaveBeenCalled()
  })

  it('leaves customer null when the id belongs to another tenant (repository returns null)', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: 'foreign-customer', customerRequestId: null })
    expect(context.customer).toBeNull()
  })

  it('includes the vehicle only via a linked CustomerRequest that has one', async () => {
    customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: 'veh1' })
    vehicleFindByIdMock.mockResolvedValue({
      id: 'veh1',
      make: 'Toyota',
      model: 'Camry',
      year: 2018,
      licensePlate: 'A123BC',
      mileage: 50000,
      notes: 'internal note, never leak',
    })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: 'req1' })
    expect(customerRequestFindByIdMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'req1')
    expect(vehicleFindByIdMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'veh1')
    expect(context.vehicle).toEqual({ make: 'Toyota', model: 'Camry', year: 2018, licensePlate: 'A123BC', mileage: 50000 })
    expect(JSON.stringify(context)).not.toContain('never leak')
  })

  it('leaves vehicle null when the linked CustomerRequest has no vehicleId', async () => {
    customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: null })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: 'req1' })
    expect(context.vehicle).toBeNull()
    expect(vehicleFindByIdMock).not.toHaveBeenCalled()
  })

  it('leaves vehicle null when there is no linked CustomerRequest at all, even with a known customer', async () => {
    customerFindByIdMock.mockResolvedValue({ id: 'cust1', firstName: 'Ivan', lastName: null, phone: '1', email: null })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: null })
    expect(context.vehicle).toBeNull()
    expect(vehicleFindByIdMock).not.toHaveBeenCalled()
  })

  it('never includes any Prisma internal id field anywhere in the serialized context', async () => {
    customerFindByIdMock.mockResolvedValue({ id: 'cust1', firstName: 'Ivan', lastName: null, phone: '1', email: null })
    customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: 'veh1' })
    vehicleFindByIdMock.mockResolvedValue({ id: 'veh1', make: 'Toyota', model: 'Camry', year: 2018, licensePlate: null, mileage: null })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain('"id"')
    expect(serialized).not.toContain('cust1')
    expect(serialized).not.toContain('veh1')
    expect(serialized).not.toContain('req1')
  })
})
