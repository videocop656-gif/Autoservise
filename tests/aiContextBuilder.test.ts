import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const {
  serviceListMock,
  knowledgeListMock,
  ruleListMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  customerRequestFindByIdMock,
  appointmentListMock,
} = vi.hoisted(() => ({
  serviceListMock: vi.fn(),
  knowledgeListMock: vi.fn(),
  ruleListMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  customerRequestFindByIdMock: vi.fn(),
  appointmentListMock: vi.fn(),
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
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { list: appointmentListMock },
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
}))

import { buildAiContext } from '../src/server/ai/contextBuilder'

function makeDecimal(value: string) {
  return { toFixed: () => value }
}

beforeEach(() => {
  vi.clearAllMocks()
  serviceListMock.mockResolvedValue([
    {
      id: 'svc1',
      name: 'Замена масла',
      description: 'desc',
      priceFrom: makeDecimal('1500.00'),
      priceTo: makeDecimal('2500.00'),
      currency: 'RUB',
      durationMinutes: 60,
    },
  ])
  knowledgeListMock.mockResolvedValue([{ title: 'FAQ', content: 'content', category: 'FAQ' }])
  ruleListMock.mockResolvedValue([{ name: 'Rule 1', description: 'desc', category: 'GENERAL', priority: 50 }])
  customerFindByIdMock.mockResolvedValue(null)
  vehicleFindByIdMock.mockResolvedValue(null)
  customerRequestFindByIdMock.mockResolvedValue(null)
  appointmentListMock.mockResolvedValue({ items: [], total: 0 })
})

describe('buildAiContext', () => {
  it('always includes business fields, never tenantId/businessId', async () => {
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

  it('serializes services with fixed-point price strings and a real id, never a raw Decimal object', async () => {
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
    expect(context.services).toEqual([
      { id: 'svc1', name: 'Замена масла', description: 'desc', priceFrom: '1500.00', priceTo: '2500.00', currency: 'RUB', durationMinutes: 60 },
    ])
  })

  it('includes the customer (with id) when the conversation has one, scoped to tenant/business', async () => {
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
    expect(context.customer).toEqual({ id: 'cust1', firstName: 'Ivan', lastName: 'Petrov', phone: '+79001234567', email: null })
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

  it('includes the vehicle (with id) only via a linked CustomerRequest that has one', async () => {
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
    expect(context.vehicle).toEqual({ id: 'veh1', make: 'Toyota', model: 'Camry', year: 2018, licensePlate: 'A123BC', mileage: 50000 })
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
    expect(appointmentListMock).not.toHaveBeenCalled()
  })

  it('never includes tenantId/businessId/secrets anywhere in the serialized context, even though entity ids are now included by design', async () => {
    customerFindByIdMock.mockResolvedValue({ id: 'cust1', firstName: 'Ivan', lastName: null, phone: '1', email: null })
    customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: 'veh1' })
    vehicleFindByIdMock.mockResolvedValue({ id: 'veh1', make: 'Toyota', model: 'Camry', year: 2018, licensePlate: null, mileage: null })
    const ctx = makeAuthContext('owner')
    const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
    const serialized = JSON.stringify(context)
    expect(serialized).not.toContain('tenantId')
    expect(serialized).not.toContain('businessId')
    // (Not asserting the raw tenant/business id strings themselves here —
    // the default fixture tenant id "t1" is a coincidental substring of
    // "cust1"/"veh1" above, which would make this assertion flaky for
    // reasons that have nothing to do with an actual leak. The key-based
    // checks above are the real, meaningful guarantee.)
    // Entity ids ARE expected now (Prompt 10) — the Tool Layer needs them to construct valid tool calls.
    expect(context.customer?.id).toBe('cust1')
    expect(context.vehicle?.id).toBe('veh1')
  })

  describe('upcomingAppointments', () => {
    const customerFixture = { id: 'cust1', firstName: 'Ivan', lastName: null, phone: '1', email: null }
    const vehicleFixture = { id: 'veh1', make: 'Toyota', model: 'Camry', year: 2018, licensePlate: null, mileage: null }

    function setKnownVehicle() {
      customerFindByIdMock.mockResolvedValue(customerFixture)
      customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: 'veh1' })
      vehicleFindByIdMock.mockResolvedValue(vehicleFixture)
    }

    it('is empty when no vehicle is known', async () => {
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
      expect(context.upcomingAppointments).toEqual([])
      expect(appointmentListMock).not.toHaveBeenCalled()
    })

    it('is scoped to the known vehicle and only future, non-cancelled dates', async () => {
      setKnownVehicle()
      const ctx = makeAuthContext('owner')
      await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(appointmentListMock).toHaveBeenCalledWith(
        ctx.tenant.id,
        ctx.business.id,
        expect.objectContaining({ vehicleId: 'veh1', includeCancelled: false })
      )
    })

    it('filters out COMPLETED/NO_SHOW appointments (only real blocking statuses remain)', async () => {
      setKnownVehicle()
      appointmentListMock.mockResolvedValue({
        items: [
          { id: 'a1', serviceId: 'svc1', startAt: new Date('2026-09-16T06:00:00Z'), endAt: new Date('2026-09-16T07:00:00Z'), status: 'SCHEDULED' },
          { id: 'a2', serviceId: 'svc1', startAt: new Date('2026-09-17T06:00:00Z'), endAt: new Date('2026-09-17T07:00:00Z'), status: 'COMPLETED' },
        ],
        total: 2,
      })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.upcomingAppointments).toHaveLength(1)
      expect(context.upcomingAppointments[0]!.id).toBe('a1')
    })

    it('includes id/serviceName/local times/status, never internal fields', async () => {
      setKnownVehicle()
      appointmentListMock.mockResolvedValue({
        items: [
          { id: 'a1', serviceId: 'svc1', startAt: new Date('2026-09-16T06:00:00Z'), endAt: new Date('2026-09-16T07:00:00Z'), status: 'SCHEDULED' },
        ],
        total: 1,
      })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.upcomingAppointments[0]).toEqual({
        id: 'a1',
        serviceName: 'Замена масла',
        startAtLocal: expect.any(String),
        endAtLocal: expect.any(String),
        status: 'SCHEDULED',
      })
    })

    it('is capped at a small bounded number of appointments', async () => {
      setKnownVehicle()
      const many = Array.from({ length: 10 }, (_, i) => ({
        id: `a${i}`,
        serviceId: 'svc1',
        startAt: new Date(Date.now() + i * 86400000),
        endAt: new Date(Date.now() + i * 86400000 + 3600000),
        status: 'SCHEDULED',
      }))
      appointmentListMock.mockResolvedValue({ items: many, total: many.length })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.upcomingAppointments.length).toBeLessThanOrEqual(5)
    })
  })
})
