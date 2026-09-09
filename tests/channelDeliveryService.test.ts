import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  connectionFindById: vi.fn(),
  messageFindById: vi.fn(),
  conversationFindById: vi.fn(),
  claimForSending: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  adapterSendMessage: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: { findById: mocks.connectionFindById },
}))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: { findById: mocks.messageFindById },
}))
vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: { findById: mocks.conversationFindById },
}))
vi.mock('../src/server/repositories/channelDeliveryRepository', () => ({
  channelDeliveryRepository: {
    claimForSending: mocks.claimForSending,
    markSent: mocks.markSent,
    markFailed: mocks.markFailed,
  },
}))
vi.mock('../src/server/channels/channelAdapterRegistry', () => ({
  getChannelAdapter: vi.fn(() => ({ channelType: 'TELEGRAM', sendMessage: mocks.adapterSendMessage })),
}))

import { sendMessageViaChannel } from '../src/server/services/channelDeliveryService'

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

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    tenantId: 't1',
    businessId: 'b1',
    conversationId: 'conv-1',
    direction: 'OUTBOUND',
    senderType: 'STAFF',
    content: 'Hello there',
    createdAt: new Date(),
    ...overrides,
  }
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    tenantId: 't1',
    businessId: 'b1',
    channel: 'TELEGRAM',
    channelConnectionId: 'conn-1',
    externalConversationId: 'ext-conv-1',
    status: 'OPEN',
    ...overrides,
  }
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'del-1',
    tenantId: 't1',
    businessId: 'b1',
    channelConnectionId: 'conn-1',
    messageId: 'msg-1',
    status: 'SENDING',
    attemptCount: 1,
    lastAttemptAt: new Date(),
    deliveredAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    externalMessageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connectionFindById.mockResolvedValue(makeConnection())
  mocks.messageFindById.mockResolvedValue(makeMessage())
  mocks.conversationFindById.mockResolvedValue(makeConversation())
})

describe('sendMessageViaChannel — connection preconditions (never create a Delivery for these)', () => {
  it('unknown/foreign connection 404s CHANNEL_NOT_FOUND, never claims a delivery', async () => {
    mocks.connectionFindById.mockResolvedValue(null)
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'missing', 'msg-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'CHANNEL_NOT_FOUND',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })

  it('an inactive connection rejects with 409 CHANNEL_INACTIVE before ever creating a Delivery (spec §20)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection({ status: 'INACTIVE' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CHANNEL_INACTIVE',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
    expect(mocks.adapterSendMessage).not.toHaveBeenCalled()
  })

  it('manager can trigger an operational send (same staff parity as receiveIncoming)', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery() })
    mocks.adapterSendMessage.mockResolvedValue({ success: true, externalMessageId: 'mock-out-1' })
    mocks.markSent.mockResolvedValue(makeDelivery({ status: 'SENT', deliveredAt: new Date(), externalMessageId: 'mock-out-1' }))
    await expect(sendMessageViaChannel(makeAuthContext('manager'), 'conn-1', 'msg-1')).resolves.toBeDefined()
  })
})

describe('sendMessageViaChannel — wrong / ineligible message rejections (spec §4, §24)', () => {
  it('a nonexistent message 404s MESSAGE_NOT_FOUND', async () => {
    mocks.messageFindById.mockResolvedValue(null)
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MESSAGE_NOT_FOUND',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })

  it('an INBOUND message is rejected as MESSAGE_NOT_OUTBOUND, never sent', async () => {
    mocks.messageFindById.mockResolvedValue(makeMessage({ direction: 'INBOUND', senderType: 'CUSTOMER' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'MESSAGE_NOT_OUTBOUND',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })

  it('an OUTBOUND message with senderType=CUSTOMER (never a real shape today, but defended anyway) is rejected as MESSAGE_NOT_OUTBOUND', async () => {
    mocks.messageFindById.mockResolvedValue(makeMessage({ senderType: 'CUSTOMER' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'MESSAGE_NOT_OUTBOUND',
    })
  })

  it('a message whose Conversation is linked to a DIFFERENT channel connection is rejected as MESSAGE_NOT_FOUND — never leaks that it exists elsewhere', async () => {
    mocks.conversationFindById.mockResolvedValue(makeConversation({ channelConnectionId: 'some-other-connection' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MESSAGE_NOT_FOUND',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })

  it('a message on a MANUAL conversation (channelConnectionId = null) is rejected as MESSAGE_NOT_FOUND, not some other code', async () => {
    mocks.conversationFindById.mockResolvedValue(makeConversation({ channelConnectionId: null, channel: 'MANUAL' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'MESSAGE_NOT_FOUND',
    })
  })

  it('a Telegram Conversation against a (hypothetically mismatched) connection type is rejected as CHANNEL_TYPE_MISMATCH (defense-in-depth, spec §21)', async () => {
    mocks.connectionFindById.mockResolvedValue(makeConnection({ type: 'WHATSAPP' }))
    // channelConnectionId still matches (so the MESSAGE_NOT_FOUND guard above doesn't fire), but channel/type disagree.
    mocks.conversationFindById.mockResolvedValue(makeConversation({ channelConnectionId: 'conn-1', channel: 'TELEGRAM' }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CHANNEL_TYPE_MISMATCH',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })

  it('a conversation with no externalConversationId is rejected as EXTERNAL_CONVERSATION_NOT_FOUND', async () => {
    mocks.conversationFindById.mockResolvedValue(makeConversation({ externalConversationId: null }))
    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'EXTERNAL_CONVERSATION_NOT_FOUND',
    })
    expect(mocks.claimForSending).not.toHaveBeenCalled()
  })
})

describe('sendMessageViaChannel — success / failure lifecycle (spec §5, §24)', () => {
  it('a claimed delivery + adapter success → markSent is called and a SENT DTO is returned, with no tenantId/businessId leaked', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery({ attemptCount: 1 }) })
    mocks.adapterSendMessage.mockResolvedValue({ success: true, externalMessageId: 'mock-out-42' })
    mocks.markSent.mockResolvedValue(makeDelivery({ status: 'SENT', attemptCount: 1, deliveredAt: new Date(), externalMessageId: 'mock-out-42' }))

    const dto = await sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')

    expect(mocks.markSent).toHaveBeenCalledWith('del-1', 'mock-out-42')
    expect(dto).toMatchObject({ status: 'SENT', attemptCount: 1, externalMessageId: 'mock-out-42' })
    expect(dto).not.toHaveProperty('tenantId')
    expect(dto).not.toHaveProperty('businessId')
  })

  it('the adapter is called with a NormalizedOutboundMessage built from the server-resolved Conversation — never from client input', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery() })
    mocks.adapterSendMessage.mockResolvedValue({ success: true, externalMessageId: 'mock-out-1' })
    mocks.markSent.mockResolvedValue(makeDelivery({ status: 'SENT' }))

    await sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')

    expect(mocks.adapterSendMessage).toHaveBeenCalledWith({
      channelType: 'TELEGRAM',
      externalConversationId: 'ext-conv-1',
      content: 'Hello there',
    })
  })

  it('adapter failure → markFailed with a safe CHANNEL_PROVIDER_ERROR code, and the service throws 502 with the same safe message, never a raw provider error', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery() })
    mocks.adapterSendMessage.mockResolvedValue({ success: false, errorMessage: 'Mock adapter simulated a send failure', retryable: true })
    mocks.markFailed.mockResolvedValue(makeDelivery({ status: 'FAILED', errorCode: 'CHANNEL_PROVIDER_ERROR', errorMessage: 'Mock adapter simulated a send failure' }))

    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 502,
      code: 'CHANNEL_PROVIDER_ERROR',
    })
    expect(mocks.markFailed).toHaveBeenCalledWith('del-1', 'CHANNEL_PROVIDER_ERROR', 'Mock adapter simulated a send failure')
  })

  it('an adapter that throws (instead of returning a failure result) is still caught, marked FAILED, and never leaks a raw exception to the client', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery() })
    mocks.adapterSendMessage.mockRejectedValue(new Error('ECONNRESET: raw network stack trace, should never reach the client'))
    mocks.markFailed.mockResolvedValue(makeDelivery({ status: 'FAILED' }))

    const err = await sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1').catch((e) => e)
    expect(err).toMatchObject({ statusCode: 502, code: 'CHANNEL_PROVIDER_ERROR' })
    expect(err.message).not.toContain('ECONNRESET')
    expect(mocks.markFailed).toHaveBeenCalledWith('del-1', 'CHANNEL_PROVIDER_ERROR', expect.any(String))
  })
})

describe('sendMessageViaChannel — idempotency and concurrency (spec §9, §10, §11, §24)', () => {
  it('an ALREADY_SENT claim never calls the adapter and returns the existing successful delivery', async () => {
    mocks.claimForSending.mockResolvedValue({
      outcome: 'ALREADY_SENT',
      delivery: makeDelivery({ status: 'SENT', deliveredAt: new Date(), externalMessageId: 'mock-out-old', attemptCount: 1 }),
    })

    const dto = await sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')

    expect(mocks.adapterSendMessage).not.toHaveBeenCalled()
    expect(dto).toMatchObject({ status: 'SENT', externalMessageId: 'mock-out-old' })
  })

  it('an IN_PROGRESS claim (another request is already SENDING) rejects with 409 DELIVERY_IN_PROGRESS, never calling the adapter a second time', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'IN_PROGRESS', delivery: makeDelivery({ status: 'SENDING' }) })

    await expect(sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'DELIVERY_IN_PROGRESS',
    })
    expect(mocks.adapterSendMessage).not.toHaveBeenCalled()
  })

  it('two concurrent calls where only one wins the claim result in exactly one adapter.sendMessage() call — the loser sees IN_PROGRESS, never a second send', async () => {
    let claimed = false
    mocks.claimForSending.mockImplementation(async () => {
      if (!claimed) {
        claimed = true
        return { outcome: 'CLAIMED', delivery: makeDelivery() }
      }
      return { outcome: 'IN_PROGRESS', delivery: makeDelivery({ status: 'SENDING' }) }
    })
    mocks.adapterSendMessage.mockResolvedValue({ success: true, externalMessageId: 'mock-out-1' })
    mocks.markSent.mockResolvedValue(makeDelivery({ status: 'SENT' }))

    const [a, b] = await Promise.allSettled([
      sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1'),
      sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1'),
    ])

    expect(a.status === 'fulfilled' || b.status === 'fulfilled').toBe(true)
    expect(a.status === 'rejected' || b.status === 'rejected').toBe(true)
    const rejected = a.status === 'rejected' ? a.reason : (b as PromiseRejectedResult).reason
    expect(rejected).toMatchObject({ statusCode: 409, code: 'DELIVERY_IN_PROGRESS' })
    expect(mocks.adapterSendMessage).toHaveBeenCalledTimes(1)
  })

  it('retry: a FAILED delivery can be claimed again — the service never distinguishes PENDING from FAILED itself, it fully trusts the repository\'s claim outcome and attemptCount', async () => {
    mocks.claimForSending.mockResolvedValue({ outcome: 'CLAIMED', delivery: makeDelivery({ attemptCount: 2 }) })
    mocks.adapterSendMessage.mockResolvedValue({ success: true, externalMessageId: 'mock-out-retry' })
    mocks.markSent.mockResolvedValue(makeDelivery({ status: 'SENT', attemptCount: 2, externalMessageId: 'mock-out-retry' }))

    const dto = await sendMessageViaChannel(makeAuthContext('owner'), 'conn-1', 'msg-1')
    expect(dto).toMatchObject({ status: 'SENT', attemptCount: 2, externalMessageId: 'mock-out-retry' })
    expect(mocks.claimForSending).toHaveBeenCalledWith('t1', 'b1', 'conn-1', 'msg-1')
  })
})

describe('sendMessageViaChannel — no client-controlled ids (spec §8, §17, §26)', () => {
  it('takes only channelConnectionId (URL) and messageId (URL) — there is no parameter for tenantId/businessId/conversationId/customerId/externalConversationId to be smuggled through', async () => {
    // Structural guarantee: the function signature itself has exactly two
    // string parameters after ctx. ctx.tenant.id/ctx.business.id (server-
    // resolved from the session) are the only tenant/business values ever
    // used — see every mocked call above always receiving 't1'/'b1', never
    // a value taken from an argument shaped like a request body.
    expect(sendMessageViaChannel.length).toBe(3)
  })
})
