import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { convListMock, convFindByIdMock, convFindByIdWithDetailMock, convCreateMock, convUpdateByIdMock, customerFindByIdMock, customerRequestFindByIdMock } =
  vi.hoisted(() => ({
    convListMock: vi.fn(),
    convFindByIdMock: vi.fn(),
    convFindByIdWithDetailMock: vi.fn(),
    convCreateMock: vi.fn(),
    convUpdateByIdMock: vi.fn(),
    customerFindByIdMock: vi.fn(),
    customerRequestFindByIdMock: vi.fn(),
  }))

vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: {
    list: convListMock,
    findById: convFindByIdMock,
    findByIdWithDetail: convFindByIdWithDetailMock,
    create: convCreateMock,
    updateById: convUpdateByIdMock,
  },
}))
vi.mock('../src/server/repositories/customerRepository', () => ({
  customerRepository: { findById: customerFindByIdMock },
}))
vi.mock('../src/server/repositories/customerRequestRepository', () => ({
  customerRequestRepository: { findById: customerRequestFindByIdMock },
}))

import { listConversations, getConversation, createConversation, updateConversation } from '../src/server/services/conversationService'

const CUSTOMER_ID = 'c1'
const REQUEST_ID = 'req1'

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return { id: CUSTOMER_ID, tenantId: 't1', businessId: 'b1', isActive: true, ...overrides }
}
function makeRequest(overrides: Record<string, unknown> = {}) {
  return { id: REQUEST_ID, tenantId: 't1', businessId: 'b1', customerId: CUSTOMER_ID, ...overrides }
}
function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv1',
    tenantId: 't1',
    businessId: 'b1',
    customerId: null,
    customerRequestId: null,
    channel: 'MANUAL',
    status: 'OPEN',
    subject: null,
    startedAt: new Date('2026-09-08T09:00:00Z'),
    lastMessageAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  customerFindByIdMock.mockResolvedValue(makeCustomer())
  customerRequestFindByIdMock.mockResolvedValue(makeRequest())
  convCreateMock.mockResolvedValue(makeConversation())
})

describe('listConversations', () => {
  it('scopes to tenant/business and forwards filters/pagination', async () => {
    convListMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('manager')
    await listConversations(ctx, { page: 1, pageSize: 20 })
    expect(convListMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, { page: 1, pageSize: 20, skip: 0, take: 20 })
  })
})

describe('getConversation', () => {
  it('returns 404 for an unknown conversation', async () => {
    convFindByIdWithDetailMock.mockResolvedValue(null)
    await expect(getConversation(makeAuthContext('owner'), 'unknown')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns the detail (with whatever the repository attached)', async () => {
    convFindByIdWithDetailMock.mockResolvedValue(makeConversation({ messages: [] }))
    const result = await getConversation(makeAuthContext('owner'), 'conv1')
    expect(result.id).toBe('conv1')
  })
})

describe('createConversation — permissions', () => {
  it('allows owner, admin, AND manager to create', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      convCreateMock.mockResolvedValue(makeConversation())
      await expect(createConversation(makeAuthContext(role), { channel: 'MANUAL' } as never)).resolves.toBeDefined()
    }
  })
})

describe('createConversation — relations', () => {
  it('creates with no customer/customerRequest at all (unknown caller)', async () => {
    await createConversation(makeAuthContext('owner'), { channel: 'WEBSITE' } as never)
    expect(customerFindByIdMock).not.toHaveBeenCalled()
    expect(customerRequestFindByIdMock).not.toHaveBeenCalled()
    expect(convCreateMock).toHaveBeenCalledWith(expect.objectContaining({ customerId: null, customerRequestId: null, status: 'OPEN' }))
  })

  it('returns 404 when the customer belongs to another tenant / does not exist', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(
      createConversation(makeAuthContext('owner'), { channel: 'PHONE', customerId: CUSTOMER_ID } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns 404 when the customerRequest belongs to another tenant / does not exist', async () => {
    customerRequestFindByIdMock.mockResolvedValue(null)
    await expect(
      createConversation(makeAuthContext('owner'), { channel: 'PHONE', customerRequestId: REQUEST_ID } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('accepts a matching customer + customerRequest pair', async () => {
    await expect(
      createConversation(makeAuthContext('owner'), { channel: 'PHONE', customerId: CUSTOMER_ID, customerRequestId: REQUEST_ID } as never)
    ).resolves.toBeDefined()
  })

  it('rejects a customer + customerRequest pair that disagree on customer (400)', async () => {
    customerRequestFindByIdMock.mockResolvedValue(makeRequest({ customerId: 'someone-else' }))
    await expect(
      createConversation(makeAuthContext('owner'), { channel: 'PHONE', customerId: CUSTOMER_ID, customerRequestId: REQUEST_ID } as never)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('accepts a customerRequestId with no customerId given at all (no conflict to check)', async () => {
    await expect(
      createConversation(makeAuthContext('owner'), { channel: 'PHONE', customerRequestId: REQUEST_ID } as never)
    ).resolves.toBeDefined()
    expect(customerFindByIdMock).not.toHaveBeenCalled()
  })

  it('defaults startedAt to now() when omitted, and status to OPEN', async () => {
    await createConversation(makeAuthContext('owner'), { channel: 'MANUAL' } as never)
    const call = convCreateMock.mock.calls[0]![0] as { status: string; startedAt: Date }
    expect(call.status).toBe('OPEN')
    expect(call.startedAt).toBeInstanceOf(Date)
  })
})

describe('updateConversation', () => {
  beforeEach(() => {
    convFindByIdMock.mockResolvedValue(makeConversation())
    convUpdateByIdMock.mockResolvedValue(makeConversation({ subject: 'Updated' }))
  })

  it('returns 404 for an unknown/foreign-tenant conversation', async () => {
    convFindByIdMock.mockResolvedValue(null)
    await expect(updateConversation(makeAuthContext('owner'), 'unknown', { subject: 'x' } as never)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('a plain field edit does NOT re-check relations', async () => {
    await updateConversation(makeAuthContext('owner'), 'conv1', { subject: 'x' } as never)
    expect(customerFindByIdMock).not.toHaveBeenCalled()
    expect(customerRequestFindByIdMock).not.toHaveBeenCalled()
  })

  it('re-validates relations when customerId IS being changed', async () => {
    customerFindByIdMock.mockResolvedValue(null)
    await expect(
      updateConversation(makeAuthContext('owner'), 'conv1', { customerId: 'new-customer' } as never)
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects an inconsistent customer/customerRequest pair on update', async () => {
    convFindByIdMock.mockResolvedValue(makeConversation({ customerRequestId: REQUEST_ID }))
    customerRequestFindByIdMock.mockResolvedValue(makeRequest({ customerId: 'someone-else' }))
    await expect(
      updateConversation(makeAuthContext('owner'), 'conv1', { customerId: CUSTOMER_ID } as never)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  describe('status lifecycle', () => {
    it('OPEN -> CLOSED sets closedAt to now() when not given', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN', closedAt: null }))
      await updateConversation(makeAuthContext('owner'), 'conv1', { status: 'CLOSED' } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as { status: string; closedAt: Date }
      expect(call.status).toBe('CLOSED')
      expect(call.closedAt).toBeInstanceOf(Date)
    })

    it('OPEN -> CLOSED honors an explicit closedAt', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN', closedAt: null }))
      const explicit = new Date('2026-01-01T00:00:00Z')
      await updateConversation(makeAuthContext('owner'), 'conv1', { status: 'CLOSED', closedAt: explicit } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as { closedAt: Date }
      expect(call.closedAt).toBe(explicit)
    })

    it('CLOSED -> OPEN always forces closedAt to null, ignoring any given closedAt', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'CLOSED', closedAt: new Date() }))
      await updateConversation(makeAuthContext('owner'), 'conv1', { status: 'OPEN', closedAt: new Date() } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as { status: string; closedAt: null }
      expect(call.status).toBe('OPEN')
      expect(call.closedAt).toBeNull()
    })

    it('OPEN -> OPEN is a no-op on closedAt when not given', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN', closedAt: null }))
      await updateConversation(makeAuthContext('owner'), 'conv1', { status: 'OPEN' } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as Record<string, unknown>
      expect('closedAt' in call).toBe(false)
    })

    it('CLOSED -> CLOSED is a no-op on closedAt when not given', async () => {
      const existingClosedAt = new Date('2026-01-01T00:00:00Z')
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'CLOSED', closedAt: existingClosedAt }))
      await updateConversation(makeAuthContext('owner'), 'conv1', { status: 'CLOSED' } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as Record<string, unknown>
      expect('closedAt' in call).toBe(false)
    })

    it('a bare closedAt PATCH (no status field) is applied directly', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN' }))
      const explicit = new Date('2026-02-02T00:00:00Z')
      await updateConversation(makeAuthContext('owner'), 'conv1', { closedAt: explicit } as never)
      const call = convUpdateByIdMock.mock.calls[0]![3] as { closedAt: Date; status?: string }
      expect(call.closedAt).toBe(explicit)
      expect('status' in call).toBe(false)
    })

    it('Manager can change status', async () => {
      convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN' }))
      await expect(
        updateConversation(makeAuthContext('manager'), 'conv1', { status: 'CLOSED' } as never)
      ).resolves.toBeDefined()
    })
  })
})
