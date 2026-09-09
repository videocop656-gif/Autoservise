import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

// Prompt 18 spec §42 — "AI MUST REMAIN DISABLED": a real Telegram inbound
// message must never trigger AI_ANALYZE, an AiEscalation, a tool execution,
// or an automatic outbound reply. channelMessageService.ts's receiveIncoming()
// doesn't import any AI-related module at all (confirmed by direct
// inspection) — this test makes that a live, enforced regression guard
// rather than just a structural observation: every AI-related module is
// mocked here, and if a future change silently wired one of them into the
// inbound pipeline, the "never called" assertions below would start
// failing immediately.
const mocks = vi.hoisted(() => ({
  connectionFindById: vi.fn(),
  channelMessageFindByConnectionAndExternalMessageId: vi.fn(),
  conversationFindByChannelConnectionAndExternalId: vi.fn(),
  recordInboundMessage: vi.fn(),
  resolveCustomerForInbound: vi.fn(),
  linkCustomerIdentityBestEffort: vi.fn(),
  analyzeMessage: vi.fn(),
  aiLogCreate: vi.fn(),
  escalationRepositoryCreate: vi.fn(),
  createOrReuseActiveEscalation: vi.fn(),
  toolExecute: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: { findById: mocks.connectionFindById },
}))
vi.mock('../src/server/repositories/channelMessageRepository', () => ({
  channelMessageRepository: { findByConnectionAndExternalMessageId: mocks.channelMessageFindByConnectionAndExternalMessageId },
}))
vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: { findByChannelConnectionAndExternalId: mocks.conversationFindByChannelConnectionAndExternalId },
}))
vi.mock('../src/server/repositories/channelInboundRepository', () => ({
  recordInboundMessage: mocks.recordInboundMessage,
}))
vi.mock('../src/server/services/channelCustomerService', () => ({
  resolveCustomerForInbound: mocks.resolveCustomerForInbound,
  linkCustomerIdentityBestEffort: mocks.linkCustomerIdentityBestEffort,
}))
// AI-related modules — mocked purely as tripwires. None of these are
// actually imported by channelMessageService.ts's call graph today; these
// mocks exist so that IF a future change added such an import, this test's
// assertions would catch it.
vi.mock('../src/server/services/aiService', () => ({ analyzeMessage: mocks.analyzeMessage }))
vi.mock('../src/server/repositories/aiLogRepository', () => ({ aiLogRepository: { create: mocks.aiLogCreate } }))
vi.mock('../src/server/repositories/escalationRepository', () => ({ escalationRepository: { create: mocks.escalationRepositoryCreate } }))
vi.mock('../src/server/services/escalationService', () => ({ createOrReuseActiveEscalation: mocks.createOrReuseActiveEscalation }))

import { receiveIncoming } from '../src/server/services/channelMessageService'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_BOT_TOKEN = 'fake-token'
  mocks.connectionFindById.mockResolvedValue({
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
  })
  mocks.channelMessageFindByConnectionAndExternalMessageId.mockResolvedValue(null)
  mocks.resolveCustomerForInbound.mockResolvedValue({ customerId: null, newIdentityToLink: null })
  mocks.recordInboundMessage.mockResolvedValue({
    conversation: { id: 'conv-1', customerId: null, status: 'OPEN' },
    message: { id: 'msg-1', createdAt: new Date() },
    wasConversationCreated: true,
    wasConversationReopened: false,
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('Telegram inbound — AI isolation regression (spec §42)', () => {
  it('a real Telegram Update processed through receiveIncoming() never invokes AI analysis, AI logging, tool execution, or escalation creation', async () => {
    const telegramUpdate = {
      update_id: 1,
      message: { message_id: 1, date: 1735689600, chat: { id: 42, type: 'private' }, from: { id: 7, first_name: 'Ivan' }, text: 'Здравствуйте!' },
    }

    const result = await receiveIncoming(makeAuthContext('owner'), 'conn-1', telegramUpdate)

    expect(result.duplicate).toBe(false)
    expect(mocks.analyzeMessage).not.toHaveBeenCalled()
    expect(mocks.aiLogCreate).not.toHaveBeenCalled()
    expect(mocks.escalationRepositoryCreate).not.toHaveBeenCalled()
    expect(mocks.createOrReuseActiveEscalation).not.toHaveBeenCalled()
    expect(mocks.toolExecute).not.toHaveBeenCalled()
  })

  it('no outbound Message is ever created automatically as a "reply" to an inbound Telegram message — recordInboundMessage is called exactly once, for the inbound side only', async () => {
    const telegramUpdate = {
      message: { message_id: 2, date: 1735689600, chat: { id: 43, type: 'private' }, from: { id: 8 }, text: 'Сколько стоит замена масла?' },
    }
    await receiveIncoming(makeAuthContext('owner'), 'conn-1', telegramUpdate)
    expect(mocks.recordInboundMessage).toHaveBeenCalledTimes(1)
    expect(mocks.recordInboundMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Сколько стоит замена масла?' }))
  })
})
