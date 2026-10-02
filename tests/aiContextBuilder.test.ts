import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'

const {
  serviceListMock,
  knowledgeListMock,
  ruleListMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  customerRequestFindByIdMock,
  appointmentListMock,
  serviceRecordListMock,
  hoursListByBusinessMock,
  vehicleListMock,
} = vi.hoisted(() => ({
  serviceListMock: vi.fn(),
  knowledgeListMock: vi.fn(),
  ruleListMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  customerRequestFindByIdMock: vi.fn(),
  appointmentListMock: vi.fn(),
  serviceRecordListMock: vi.fn(),
  hoursListByBusinessMock: vi.fn(),
  vehicleListMock: vi.fn(),
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
  vehicleRepository: { findById: vehicleFindByIdMock, list: vehicleListMock },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: { findById: customerRequestFindByIdMock },
}))
vi.mock('../src/server/repositories/appointmentRepository', () => ({
  appointmentRepository: { list: appointmentListMock },
  CONFLICT_BLOCKING_STATUSES: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
}))
vi.mock('../src/server/repositories/serviceRecordRepository', () => ({
  serviceRecordRepository: { list: serviceRecordListMock },
}))
// Prompt 53 — working hours are part of the AI context now.
vi.mock('../src/server/repositories/workingHoursRepository', () => ({
  workingHoursRepository: { listByBusiness: hoursListByBusinessMock },
}))

import { buildAiContext } from '../src/server/ai/contextBuilder'

function makeDecimal(value: string) {
  return { toFixed: () => value, toString: () => value }
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
      priceNote: null,
      requiresInspection: false,
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
  serviceRecordListMock.mockResolvedValue({ items: [], total: 0 })
  hoursListByBusinessMock.mockResolvedValue([])
  vehicleListMock.mockResolvedValue({ items: [], total: 0 })
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
      locationUrl: ctx.business.locationUrl,
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
      {
        id: 'svc1',
        name: 'Замена масла',
        description: 'desc',
        // MCR-3 — explicit pricing facts instead of raw nullable bounds.
        pricing: { type: 'RANGE', formatted: '1 500–2 500 ₽', min: '1500.00', max: '2500.00' },
        priceNote: null,
        requiresInspection: false,
        currency: 'RUB',
        durationMinutes: 60,
      },
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

  describe('serviceHistory (Prompt 11)', () => {
    const customerFixture = { id: 'cust1', firstName: 'Ivan', lastName: null, phone: '1', email: null }
    const vehicleFixture = { id: 'veh1', make: 'Toyota', model: 'Camry', year: 2018, licensePlate: null, mileage: null }

    function setKnownVehicle() {
      customerFindByIdMock.mockResolvedValue(customerFixture)
      customerRequestFindByIdMock.mockResolvedValue({ id: 'req1', vehicleId: 'veh1' })
      vehicleFindByIdMock.mockResolvedValue(vehicleFixture)
    }

    function makeRecord(overrides: Record<string, unknown> = {}) {
      return {
        serviceId: 'svc1',
        performedAt: new Date('2026-08-15T09:00:00Z'),
        mileage: 82400,
        totalPrice: makeDecimal('3500.00'),
        currency: 'RUB',
        workDescription: 'Замена масла и масляного фильтра',
        partsDescription: null,
        recommendations: 'Проверить тормозные колодки на следующем визите',
        notes: null,
        ...overrides,
      }
    }

    it('is empty when no vehicle is known', async () => {
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: null, customerRequestId: null })
      expect(context.serviceHistory).toEqual([])
      expect(serviceRecordListMock).not.toHaveBeenCalled()
    })

    it('is scoped to the known vehicle and excludes archived records by default', async () => {
      setKnownVehicle()
      const ctx = makeAuthContext('owner')
      await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(serviceRecordListMock).toHaveBeenCalledWith(
        ctx.tenant.id,
        ctx.business.id,
        expect.objectContaining({ vehicleId: 'veh1', includeArchived: false })
      )
    })

    it('is bounded to a small recent window (take <= 10)', async () => {
      setKnownVehicle()
      const ctx = makeAuthContext('owner')
      await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      const call = serviceRecordListMock.mock.calls[0]![2] as { take: number }
      expect(call.take).toBeLessThanOrEqual(10)
    })

    it('maps real ServiceRecord fields — never raw Decimal, never internal ids', async () => {
      setKnownVehicle()
      serviceRecordListMock.mockResolvedValue({ items: [makeRecord()], total: 1 })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.serviceHistory).toEqual([
        {
          performedAtLocal: '2026-08-15',
          serviceName: 'Замена масла',
          mileage: 82400,
          totalPrice: '3500.00',
          currency: 'RUB',
          workDescription: 'Замена масла и масляного фильтра',
          partsDescription: null,
          recommendations: 'Проверить тормозные колодки на следующем визите',
          notes: null,
        },
      ])
      const serialized = JSON.stringify(context.serviceHistory)
      expect(serialized).not.toContain('customerId')
      expect(serialized).not.toContain('vehicleId')
      expect(serialized).not.toContain('serviceId')
      expect(serialized).not.toContain('appointmentId')
    })

    it('falls back to "Unknown service" when the record references a since-deactivated service (same convention as upcomingAppointments)', async () => {
      setKnownVehicle()
      serviceRecordListMock.mockResolvedValue({ items: [makeRecord({ serviceId: 'deactivated-svc' })], total: 1 })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.serviceHistory[0]!.serviceName).toBe('Unknown service')
    })

    it('preserves the repository\'s newest-first ordering (never re-sorted client-side)', async () => {
      setKnownVehicle()
      serviceRecordListMock.mockResolvedValue({
        items: [
          makeRecord({ performedAt: new Date('2026-08-15T09:00:00Z'), workDescription: 'Newer visit' }),
          makeRecord({ performedAt: new Date('2026-01-10T09:00:00Z'), workDescription: 'Older visit' }),
        ],
        total: 2,
      })
      const ctx = makeAuthContext('owner')
      const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: 'req1' })
      expect(context.serviceHistory[0]!.workDescription).toBe('Newer visit')
      expect(context.serviceHistory[1]!.workDescription).toBe('Older visit')
    })
  })
})

// ---------------------------------------------------------------------------
// Prompt 53 — current date and working hours in the business's own timezone.
// ---------------------------------------------------------------------------
describe('buildAiContext — current business-local date and working hours (Prompt 53)', () => {
  const conversation = { customerId: null, customerRequestId: null }
  const instant = new Date('2026-10-04T13:00:00Z') // Sunday 13:00 UTC

  it('gives the date, time and weekday in the business timezone (Moscow, UTC+3)', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'Europe/Moscow' }) })
    const context = await buildAiContext(ctx, conversation, instant)
    expect(context.currentDateTime).toEqual({ date: '2026-10-04', time: '16:00', dayOfWeek: 'SUNDAY' })
  })

  it('crosses the day boundary with the business, not the server (Asia/Kamchatka, UTC+12 → already Monday)', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'Asia/Kamchatka' }) })
    const context = await buildAiContext(ctx, conversation, instant)
    expect(context.currentDateTime).toEqual({ date: '2026-10-05', time: '01:00', dayOfWeek: 'MONDAY' })
  })

  it('a DST zone gets its summer offset (America/New_York, EDT UTC−4)', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'America/New_York' }) })
    const context = await buildAiContext(ctx, conversation, instant)
    expect(context.currentDateTime).toEqual({ date: '2026-10-04', time: '09:00', dayOfWeek: 'SUNDAY' })
  })

  it('defaults to the real clock when no instant is given', async () => {
    const context = await buildAiContext(makeAuthContext('owner'), conversation)
    expect(context.currentDateTime.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(context.currentDateTime.time).toMatch(/^\d{2}:\d{2}$/)
  })

  it('includes the configured week from the session business only; a closed day carries no times', async () => {
    hoursListByBusinessMock.mockResolvedValue([
      { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { dayOfWeek: 'SUNDAY', isOpen: false, openTime: '10:00', closeTime: '12:00' },
    ])
    const ctx = makeAuthContext('owner', { business: makeBusiness({ id: 'business-a' }) })
    const context = await buildAiContext(ctx, conversation, instant)

    expect(hoursListByBusinessMock).toHaveBeenCalledWith('business-a')
    expect(context.workingHours).toEqual([
      { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
      { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
    ])
  })

  it('services, knowledge and rules are still included alongside', async () => {
    const context = await buildAiContext(makeAuthContext('owner'), conversation, instant)
    expect(context.services).toHaveLength(1)
    expect(context.knowledge).toHaveLength(1)
    expect(context.rules).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Prompt 54 — the known customer's stored vehicles (trusted context, no ids).
// ---------------------------------------------------------------------------
describe('buildAiContext — customerVehicles (Prompt 54)', () => {
  const customerRow = { id: 'cust1', firstName: 'Ivan', lastName: null, phone: '+79001234567', email: null, isActive: true }

  it('lists the linked customer’s active vehicles, scoped to tenant/business/customer, without ids', async () => {
    customerFindByIdMock.mockResolvedValue(customerRow)
    vehicleListMock.mockResolvedValue({
      items: [{ id: 'veh-secret-id', customerId: 'cust1', make: 'Kia', model: 'Rio', year: 2019, licensePlate: 'A123BC77', vin: 'VIN123', mileage: 1000, notes: 'private' }],
      total: 1,
    })
    const ctx = makeAuthContext('owner', { business: makeBusiness({ id: 'business-a' }) })
    const context = await buildAiContext(ctx, { customerId: 'cust1', customerRequestId: null })

    expect(vehicleListMock).toHaveBeenCalledWith(ctx.tenant.id, 'business-a', expect.objectContaining({ activeOnly: true, customerId: 'cust1' }))
    expect(context.customerVehicles).toEqual([{ make: 'Kia', model: 'Rio', year: 2019, licensePlate: 'A123BC77' }])
    expect(JSON.stringify(context.customerVehicles)).not.toMatch(/veh-secret-id|VIN123|private/)
  })

  it('a stored vehicle list is context only — `vehicle` stays null without a linked request', async () => {
    customerFindByIdMock.mockResolvedValue(customerRow)
    vehicleListMock.mockResolvedValue({ items: [{ id: 'v1', make: 'Kia', model: 'Rio', year: 2019, licensePlate: null }], total: 1 })
    const context = await buildAiContext(makeAuthContext('owner'), { customerId: 'cust1', customerRequestId: null })
    expect(context.vehicle).toBeNull()
    expect(context.customerVehicles).toHaveLength(1)
  })

  it('no customer (or a foreign one the scoped lookup cannot find) → no vehicles, no vehicle query', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    const context = await buildAiContext(makeAuthContext('owner'), { customerId: 'foreign', customerRequestId: null })
    expect(context.customerVehicles).toEqual([])
    expect(vehicleListMock).not.toHaveBeenCalled()
  })
})
