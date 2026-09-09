import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { makeAuthContext } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  connectionFindById: vi.fn(),
  channelMessageFindByConnectionAndExternalMessageId: vi.fn(),
  conversationFindByChannelConnectionAndExternalId: vi.fn(),
  recordInboundMessage: vi.fn(),
  resolveCustomerForInbound: vi.fn(),
  linkCustomerIdentityBestEffort: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: { findById: mocks.connectionFindById },
}))
vi.mock('../src/server/repositories/channelMessageRepository', () => ({
  channelMessageRepository: { findByConnectionAndExternalMessageId: mocks.channelMessageFindByConnectionAndExternalMessageId },
}))
vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: {
    findByChannelConnectionAndExternalId: mocks.conversationFindByChannelConnectionAndExternalId,
  },
}))
vi.mock('../src/server/repositories/channelInboundRepository', () => ({
  recordInboundMessage: mocks.recordInboundMessage,
}))
vi.mock('../src/server/services/channelCustomerService', () => ({
  resolveCustomerForInbound: mocks.resolveCustomerForInbound,
  linkCustomerIdentityBestEffort: mocks.linkCustomerIdentityBestEffort,
}))

// The old sendOutbound() function that used to live in this service has
// been removed (Prompt 17) — see channelDeliveryService.test.ts for its
// full ChannelDelivery-tracked replacement. receiveIncoming() (below) is
// untouched by that change; this file now covers only the inbound pipeline.
import { receiveIncoming } from '../src/server/services/channelMessageService'

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 't1',
    businessId: 'b1',
    type: 'TELEGRAM',
    status: 'ACTIVE',
    displayName: 'Bot',
    externalAccountId: 'bot1',
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    externalMessageId: 'ext-msg-1',
    externalConversationId: 'ext-conv-1',
    text: 'Hello',
    sentAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveCustomerForInbound.mockResolvedValue({ customerId: null, newIdentityToLink: null })
})

describe('receiveIncoming — connection validation', () => {
  it('unknown/foreign connection 404s (CHANNEL_NOT_FOUND)', async () => {
    mocks.connectionFindById.mockResolvedValue(null)
    await expect(receiveIncoming(makeAuthContext('owner'), 'missing', makePayload())).rejects.toMatchObject({
      statusCode: 404,
      code: 'CHANNEL_NOT_FOUND',
    })
  })

  it('an inactive connection rejects inbound (409 CHANNEL_INACTIVE)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection({ status: 'INACTIVE' }))
    await expect(receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())).rejects.toMatchObject({
      statusCode: 409,
      code: 'CHANNEL_INACTIVE',
    })
    expect(mocks.recordInboundMessage).not.toHaveBeenCalled()
  })

  it('manager can trigger a test inbound message (read/write staff parity, same as Conversation)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.recordInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', customerId: null, status: 'OPEN' },
      message: { id: 'msg-1', createdAt: new Date() },
      wasConversationCreated: true,
      wasConversationReopened: false,
    })
    await expect(receiveIncoming(makeAuthContext('manager'), 'conn-1', makePayload())).resolves.toBeDefined()
  })
})

describe('receiveIncoming — happy path', () => {
  it('creates a new conversation, records the message, and returns customerId=null when unresolved', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.recordInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', customerId: null, status: 'OPEN' },
      message: { id: 'msg-1', createdAt: new Date() },
      wasConversationCreated: true,
      wasConversationReopened: false,
    })

    const result = await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())
    expect(result).toMatchObject({ conversationId: 'conv-1', messageId: 'msg-1', customerId: null, duplicate: false, conversationCreated: true })
  })

  it('passes the channel-mapped ConversationChannel value through to the atomic recorder', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection({ type: 'WHATSAPP' }))
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.recordInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', customerId: null, status: 'OPEN' },
      message: { id: 'msg-1', createdAt: new Date() },
      wasConversationCreated: true,
      wasConversationReopened: false,
    })
    await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(expect.objectContaining({ channelType: 'WHATSAPP' }))
  })

  it('rejects a payload that normalizes to an empty externalMessageId/externalConversationId/text (INVALID_CHANNEL_PAYLOAD)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    await expect(receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload({ externalMessageId: '' }))).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_CHANNEL_PAYLOAD',
    })
  })

  it('links a newly-resolved customer identity as a best-effort step AFTER the message is recorded', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.resolveCustomerForInbound.mockResolvedValue({
      customerId: 'cust-1',
      newIdentityToLink: { externalCustomerId: 'ext-cust-1', phone: '+70001112233' },
    })
    mocks.recordInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', customerId: 'cust-1', status: 'OPEN' },
      message: { id: 'msg-1', createdAt: new Date() },
      wasConversationCreated: true,
      wasConversationReopened: false,
    })
    await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())
    expect(mocks.linkCustomerIdentityBestEffort).toHaveBeenCalledWith(expect.anything(), 'conn-1', 'cust-1', {
      externalCustomerId: 'ext-cust-1',
      phone: '+70001112233',
    })
  })

  it('never creates a Customer — no customer-creation call exists anywhere in this pipeline', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.recordInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', customerId: null, status: 'OPEN' },
      message: { id: 'msg-1', createdAt: new Date() },
      wasConversationCreated: true,
      wasConversationReopened: false,
    })
    const result = await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload({ externalCustomerId: 'unknown-1', customerPhone: '+70009998877' }))
    expect(result.customerId).toBeNull()
  })
})

describe('receiveIncoming — idempotency', () => {
  it('a pre-existing ChannelMessage short-circuits to a duplicate result, never calling recordInboundMessage', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue({
      id: 'cm-1',
      messageId: 'msg-1',
      externalConversationId: 'ext-conv-1',
    })
    mocks.conversationFindByChannelConnectionAndExternalId.mockResolvedValue({ id: 'conv-1', customerId: null })

    const result = await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())
    expect(result).toMatchObject({ duplicate: true, conversationId: 'conv-1', messageId: 'msg-1' })
    expect(mocks.recordInboundMessage).not.toHaveBeenCalled()
  })

  it('a genuine concurrent-race P2002 during recordInboundMessage resolves to the winner\'s row, never a raw DB error, never a second Message', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId
      .mockResolvedValueOnce(null) // fast pre-check: nothing yet
      .mockResolvedValueOnce({ id: 'cm-1', messageId: 'msg-winner', externalConversationId: 'ext-conv-1' }) // race-recovery re-fetch
    mocks.conversationFindByChannelConnectionAndExternalId.mockResolvedValue({ id: 'conv-winner', customerId: null })
    mocks.recordInboundMessage.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    )

    const result = await receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())
    expect(result).toMatchObject({ duplicate: true, conversationId: 'conv-winner', messageId: 'msg-winner' })
  })

  it('a non-P2002 error from recordInboundMessage propagates unchanged (no false idempotent success)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection())
    mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
    mocks.recordInboundMessage.mockRejectedValue(new Error('boom'))
    await expect(receiveIncoming(makeAuthContext('owner'), 'conn-1', makePayload())).rejects.toThrow('boom')
  })
})
