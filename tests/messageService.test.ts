import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { convFindByIdMock, createAndTouchMock } = vi.hoisted(() => ({
  convFindByIdMock: vi.fn(),
  createAndTouchMock: vi.fn(),
}))

vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: { findById: convFindByIdMock },
}))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: { createAndTouchConversation: createAndTouchMock },
}))

import { createMessage } from '../src/server/services/messageService'

function makeConversation(overrides: Record<string, unknown> = {}) {
  return { id: 'conv1', tenantId: 't1', businessId: 'b1', status: 'OPEN', ...overrides }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return { direction: 'INBOUND', senderType: 'CUSTOMER', content: 'hello', ...overrides } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  convFindByIdMock.mockResolvedValue(makeConversation())
  createAndTouchMock.mockResolvedValue({ id: 'm1', conversationId: 'conv1', direction: 'INBOUND', senderType: 'CUSTOMER', content: 'hello', createdAt: new Date() })
})

describe('createMessage — permissions', () => {
  it('allows owner, admin, AND manager', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(createMessage(makeAuthContext(role), 'conv1', baseInput())).resolves.toBeDefined()
    }
  })
})

describe('createMessage', () => {
  it('returns 404 for an unknown/foreign-tenant conversation', async () => {
    convFindByIdMock.mockResolvedValue(null)
    await expect(createMessage(makeAuthContext('owner'), 'unknown', baseInput())).rejects.toMatchObject({ statusCode: 404 })
    expect(createAndTouchMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the conversation is CLOSED', async () => {
    convFindByIdMock.mockResolvedValue(makeConversation({ status: 'CLOSED' }))
    await expect(createMessage(makeAuthContext('owner'), 'conv1', baseInput())).rejects.toMatchObject({ statusCode: 409 })
    expect(createAndTouchMock).not.toHaveBeenCalled()
  })

  it('succeeds when the conversation is OPEN, scoped to tenant/business', async () => {
    const ctx = makeAuthContext('owner')
    await createMessage(ctx, 'conv1', baseInput())
    expect(createAndTouchMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, {
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      conversationId: 'conv1',
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      content: 'hello',
    })
  })

  it('succeeds again once a previously-closed conversation is reopened (checked via the current findById result)', async () => {
    convFindByIdMock.mockResolvedValue(makeConversation({ status: 'OPEN' }))
    await expect(createMessage(makeAuthContext('owner'), 'conv1', baseInput())).resolves.toBeDefined()
  })
})
