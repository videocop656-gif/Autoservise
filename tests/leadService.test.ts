import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const {
  leadListMock,
  leadFindByIdMock,
  leadCreateMock,
  leadUpdateByIdMock,
  customerFindByIdMock,
  vehicleFindByIdMock,
  serviceFindByIdMock,
} = vi.hoisted(() => ({
  leadListMock: vi.fn(),
  leadFindByIdMock: vi.fn(),
  leadCreateMock: vi.fn(),
  leadUpdateByIdMock: vi.fn(),
  customerFindByIdMock: vi.fn(),
  vehicleFindByIdMock: vi.fn(),
  serviceFindByIdMock: vi.fn(),
}))

vi.mock('../src/server/repositories/leadRepository', () => ({
  leadRepository: { list: leadListMock, findById: leadFindByIdMock, create: leadCreateMock, updateById: leadUpdateByIdMock },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: customerFindByIdMock },
}))
vi.mock('../src/server/repositories/vehicleRepository', () => ({
  vehicleRepository: { findById: vehicleFindByIdMock },
}))
vi.mock('../src/server/repositories/serviceRepository', () => ({
  serviceRepository: { findById: serviceFindByIdMock },
}))

import { listLeads, getLead, createLead, updateLead } from '../src/server/services/leadService'

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: 'c1',
    vehicleId: null,
    serviceId: null,
    status: 'NEW',
    source: 'MANUAL',
    subject: 'Question',
    description: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue({ id: 'c1', isActive: true })
})

describe('listLeads', () => {
  it('scopes to tenant/business and forwards filters/pagination', async () => {
    leadListMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listLeads(ctx, { page: 1, pageSize: 20, status: 'NEW' as never })
    expect(leadListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      page: 1,
      pageSize: 20,
      status: 'NEW',
      skip: 0,
      take: 20,
    })
  })
})

describe('getLead', () => {
  it('returns 404 for an unknown lead', async () => {
    leadFindByIdMock.mockResolvedValue(null)
    await expect(getLead(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('createLead', () => {
  it('allows owner/admin to create against a valid customer', async () => {
    leadCreateMock.mockResolvedValue(makeLead())
    const ctx = makeAuthContext('owner')
    await createLead(ctx, { customerId: 'c1', subject: 'Question' } as never)
    expect(leadCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, customerId: 'c1', status: 'NEW', source: 'MANUAL' })
    )
  })

  it('rejects manager from creating', async () => {
    await expect(createLead(makeAuthContext('manager'), { customerId: 'c1', subject: 'Q' } as never)).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the customer belongs to another tenant / does not exist', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(
      createLead(makeAuthContext('owner'), { customerId: 'foreign-customer', subject: 'Q' } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the vehicle belongs to another tenant / does not exist', async () => {
    vehicleFindByIdMock.mockResolvedValue(null)
    await expect(
      createLead(makeAuthContext('owner'), { customerId: 'c1', vehicleId: 'foreign-vehicle', subject: 'Q' } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the vehicle belongs to a different customer within the same tenant', async () => {
    vehicleFindByIdMock.mockResolvedValue({ id: 'v1', customerId: 'c2' })
    await expect(
      createLead(makeAuthContext('owner'), { customerId: 'c1', vehicleId: 'v1', subject: 'Q' } as never)
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('accepts a vehicle that does belong to the specified customer', async () => {
    vehicleFindByIdMock.mockResolvedValue({ id: 'v1', customerId: 'c1' })
    leadCreateMock.mockResolvedValue(makeLead({ vehicleId: 'v1' }))
    await expect(
      createLead(makeAuthContext('owner'), { customerId: 'c1', vehicleId: 'v1', subject: 'Q' } as never)
    ).resolves.toBeDefined()
  })

  it('returns 404 when the service belongs to another tenant / does not exist', async () => {
    serviceFindByIdMock.mockResolvedValue(null)
    await expect(
      createLead(makeAuthContext('owner'), { customerId: 'c1', serviceId: 'foreign-service', subject: 'Q' } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })

  it('rejects creating a lead for an inactive customer (400, not 404 — the customer exists)', async () => {
    customerFindByIdMock.mockResolvedValue({ id: 'c1', isActive: false })
    await expect(createLead(makeAuthContext('owner'), { customerId: 'c1', subject: 'Q' } as never)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
    expect(leadCreateMock).not.toHaveBeenCalled()
  })
})

describe('updateLead', () => {
  it('allows a status transition', async () => {
    leadFindByIdMock.mockResolvedValue(makeLead())
    leadUpdateByIdMock.mockResolvedValue(makeLead({ status: 'QUALIFIED' }))
    const result = await updateLead(makeAuthContext('owner'), 'l1', { status: 'QUALIFIED' } as never)
    expect(result.status).toBe('QUALIFIED')
  })

  it('rejects manager from updating (including status)', async () => {
    await expect(updateLead(makeAuthContext('manager'), 'l1', { status: 'LOST' } as never)).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(leadFindByIdMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown/foreign-tenant lead', async () => {
    leadFindByIdMock.mockResolvedValue(null)
    await expect(updateLead(makeAuthContext('owner'), 'unknown', { status: 'LOST' } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('does NOT require the customer to be active when updating an existing lead (e.g. closing it out after the customer left)', async () => {
    leadFindByIdMock.mockResolvedValue(makeLead())
    customerFindByIdMock.mockResolvedValue({ id: 'c1', isActive: false })
    leadUpdateByIdMock.mockResolvedValue(makeLead({ status: 'LOST' }))
    await expect(updateLead(makeAuthContext('owner'), 'l1', { status: 'LOST' } as never)).resolves.toBeDefined()
  })

  it('re-validates the vehicle against the EXISTING customer when only vehicleId changes', async () => {
    leadFindByIdMock.mockResolvedValue(makeLead({ customerId: 'c1', vehicleId: null }))
    vehicleFindByIdMock.mockResolvedValue({ id: 'v9', customerId: 'c2' })
    await expect(updateLead(makeAuthContext('owner'), 'l1', { vehicleId: 'v9' } as never)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('re-validates against the NEW customer when both customerId and vehicleId change together', async () => {
    leadFindByIdMock.mockResolvedValue(makeLead({ customerId: 'c1', vehicleId: null }))
    customerFindByIdMock.mockResolvedValue({ id: 'c2' })
    vehicleFindByIdMock.mockResolvedValue({ id: 'v9', customerId: 'c2' })
    leadUpdateByIdMock.mockResolvedValue(makeLead({ customerId: 'c2', vehicleId: 'v9' }))
    await expect(
      updateLead(makeAuthContext('owner'), 'l1', { customerId: 'c2', vehicleId: 'v9' } as never)
    ).resolves.toBeDefined()
  })

  it('allows clearing vehicleId to null', async () => {
    leadFindByIdMock.mockResolvedValue(makeLead({ vehicleId: 'v1' }))
    leadUpdateByIdMock.mockResolvedValue(makeLead({ vehicleId: null }))
    await expect(updateLead(makeAuthContext('owner'), 'l1', { vehicleId: null } as never)).resolves.toBeDefined()
    expect(vehicleFindByIdMock).not.toHaveBeenCalled()
  })
})
