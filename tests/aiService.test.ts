import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { convFindByIdMock, listByConversationMock, buildAiContextMock, executeToolMock } = vi.hoisted(() => ({
  convFindByIdMock: vi.fn(),
  listByConversationMock: vi.fn(),
  buildAiContextMock: vi.fn(),
  executeToolMock: vi.fn(),
}))

vi.mock('../src/server/repositories/conversationRepository', () => ({
  conversationRepository: { findById: convFindByIdMock },
}))
vi.mock('../src/server/repositories/messageRepository', () => ({
  messageRepository: { listByConversation: listByConversationMock },
}))
vi.mock('../src/server/ai/contextBuilder', () => ({
  buildAiContext: buildAiContextMock,
}))
vi.mock('../src/server/ai/tools/registry', () => ({
  TOOL_DEFINITIONS: [{ name: 'check_availability', description: 'x', parameters: {} }],
  executeTool: executeToolMock,
}))

import { analyzeMessage } from '../src/server/services/aiService'
import { AiProviderError } from '../src/server/ai/provider'
import { EMPTY_AI_ENTITIES } from '../src/server/ai/types'
import type { AiProvider, AiGenerationResult } from '../src/server/ai/provider'

const CONTEXT = {
  business: { name: 'Test Auto Service', description: null, phone: null, email: null, address: null, timezone: 'UTC', currency: 'RUB' },
  services: [],
  knowledge: [],
  rules: [],
  customer: null,
  vehicle: null,
  upcomingAppointments: [],
  serviceHistory: [],
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return { id: 'conv1', tenantId: 't1', businessId: 'b1', status: 'OPEN', customerId: null, customerRequestId: null, ...overrides }
}

function makeMessage(direction: 'INBOUND' | 'OUTBOUND', content: string, i: number) {
  return { id: `m${i}`, conversationId: 'conv1', direction, senderType: 'CUSTOMER', content, createdAt: new Date(2026, 0, 1, 0, i) }
}

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'PRICE_INQUIRY',
    confidence: 0.9,
    entities: { ...EMPTY_AI_ENTITIES },
    answer: 'Стоимость зависит от услуги.',
    needsHuman: false,
    reason: null,
    ...overrides,
  }
}

function makeStubProvider(raw: unknown): AiProvider {
  return { generate: vi.fn().mockResolvedValue({ type: 'final', raw } as AiGenerationResult) }
}

function makeFailingProvider(err: unknown): AiProvider {
  return { generate: vi.fn().mockRejectedValue(err) }
}

/** A provider that requests one tool call per round, forever — used to exercise the max-tool-calls limit. */
function makeInfiniteToolCaller(): AiProvider {
  let round = 0
  return {
    generate: vi.fn().mockImplementation(async () => {
      round += 1
      return { type: 'tool_calls', calls: [{ id: `t${round}`, name: 'check_availability', arguments: {} }] } as AiGenerationResult
    }),
  }
}

const baseInput = { conversationId: 'conv1', message: 'Сколько стоит замена масла?' }

beforeEach(() => {
  vi.clearAllMocks()
  convFindByIdMock.mockResolvedValue(makeConversation())
  listByConversationMock.mockResolvedValue([])
  buildAiContextMock.mockResolvedValue(CONTEXT)
  executeToolMock.mockResolvedValue({ success: true, tool: 'check_availability', data: { available: true, slots: [] } })
})

describe('analyzeMessage — permissions', () => {
  it('allows owner, admin, AND manager', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      const provider = makeStubProvider(validRaw())
      await expect(analyzeMessage(makeAuthContext(role), baseInput, { provider })).resolves.toBeDefined()
    }
  })
})

describe('analyzeMessage — conversation lookup', () => {
  it('returns 404 for an unknown/foreign-tenant conversation, tenant-scoped', async () => {
    convFindByIdMock.mockResolvedValue(null)
    const ctx = makeAuthContext('owner')
    await expect(analyzeMessage(ctx, baseInput, { provider: makeStubProvider(validRaw()) })).rejects.toMatchObject({
      statusCode: 404,
    })
    expect(convFindByIdMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'conv1')
    expect(buildAiContextMock).not.toHaveBeenCalled()
  })

  it('returns 409 when the conversation is CLOSED, without building context or calling the provider', async () => {
    convFindByIdMock.mockResolvedValue(makeConversation({ status: 'CLOSED' }))
    const provider = makeStubProvider(validRaw())
    await expect(analyzeMessage(makeAuthContext('owner'), baseInput, { provider })).rejects.toMatchObject({ statusCode: 409 })
    expect(buildAiContextMock).not.toHaveBeenCalled()
    expect(provider.generate).not.toHaveBeenCalled()
  })
})

describe('analyzeMessage — successful analysis (no tool involved)', () => {
  it('returns the validated, safety-checked result', async () => {
    const provider = makeStubProvider(validRaw())
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.intent).toBe('PRICE_INQUIRY')
    expect(result.needsHuman).toBe(false)
  })

  it('never creates a Message and never writes anything — only findById/listByConversation are mocked, and analyzeMessage never calls any write method on either repository', async () => {
    const provider = makeStubProvider(validRaw())
    await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(convFindByIdMock).toHaveBeenCalledTimes(1)
    expect(listByConversationMock).toHaveBeenCalledTimes(1)
  })

  it('has no toolExecutions field when no tool was ever called', async () => {
    const provider = makeStubProvider(validRaw())
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.toolExecutions).toBeUndefined()
  })

  it('passes the untrusted user message and trusted context/history to the provider as separate fields', async () => {
    listByConversationMock.mockResolvedValue([makeMessage('INBOUND', 'previous message', 1)])
    const provider = makeStubProvider(validRaw())
    await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: baseInput.message,
        businessContext: CONTEXT,
        history: [{ direction: 'INBOUND', content: 'previous message' }],
        toolExchanges: [],
      })
    )
  })

  it('limits history to the most recent 20 messages, in chronological order', async () => {
    const messages = Array.from({ length: 25 }, (_, i) => makeMessage(i % 2 === 0 ? 'INBOUND' : 'OUTBOUND', `msg-${i}`, i))
    listByConversationMock.mockResolvedValue(messages)
    const provider = makeStubProvider(validRaw())
    await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { history: { content: string }[] }
    expect(call.history).toHaveLength(20)
    expect(call.history[0]!.content).toBe('msg-5')
    expect(call.history[19]!.content).toBe('msg-24')
  })
})

describe('analyzeMessage — tool-calling loop', () => {
  it('executes a requested tool via the registry, tenant-scoped, and feeds the result back to the provider', async () => {
    let round = 0
    const provider: AiProvider = {
      generate: vi.fn().mockImplementation(async (req) => {
        round += 1
        if (round === 1) return { type: 'tool_calls', calls: [{ id: 't1', name: 'check_availability', arguments: { date: '2026-09-16' } }] }
        // Second round must see the tool result already appended.
        expect(req.toolExchanges).toHaveLength(1)
        return { type: 'final', raw: validRaw({ intent: 'AVAILABILITY_INQUIRY' }) }
      }),
    }
    const ctx = makeAuthContext('owner')
    const result = await analyzeMessage(ctx, baseInput, { provider })
    expect(executeToolMock).toHaveBeenCalledWith(ctx, 'check_availability', { date: '2026-09-16' }, baseInput.message, {
      customerId: null,
      vehicleId: null,
      appointmentIds: [],
    })
    expect(result.intent).toBe('AVAILABILITY_INQUIRY')
    expect(result.toolExecutions).toEqual([{ tool: 'check_availability', success: true, data: { available: true, slots: [] } }])
  })

  it('summarizes a failed tool execution without exposing internal error details beyond errorCode/message', async () => {
    executeToolMock.mockResolvedValue({ success: false, tool: 'create_appointment', errorCode: 'CONFIRMATION_REQUIRED', message: 'x' })
    let round = 0
    const provider: AiProvider = {
      generate: vi.fn().mockImplementation(async () => {
        round += 1
        if (round === 1) return { type: 'tool_calls', calls: [{ id: 't1', name: 'create_appointment', arguments: {} }] }
        return { type: 'final', raw: validRaw() }
      }),
    }
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.toolExecutions).toEqual([{ tool: 'create_appointment', success: false, errorCode: 'CONFIRMATION_REQUIRED', message: 'x' }])
  })

  it('enforces the max-3-tool-calls limit and returns a controlled fallback with needsHuman: true, never an infinite loop', async () => {
    const provider = makeInfiniteToolCaller()
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.needsHuman).toBe(true)
    expect(result.reason).toContain('AI_TOOL_LIMIT_EXCEEDED')
    // At most MAX_TOOL_CALLS (3) tool executions actually ran — proves the loop is bounded.
    expect(executeToolMock.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('allows exactly 3 tool calls across rounds, then requires a final answer on the next round', async () => {
    let round = 0
    const provider: AiProvider = {
      generate: vi.fn().mockImplementation(async () => {
        round += 1
        if (round <= 3) return { type: 'tool_calls', calls: [{ id: `t${round}`, name: 'check_availability', arguments: {} }] }
        return { type: 'final', raw: validRaw() }
      }),
    }
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(executeToolMock).toHaveBeenCalledTimes(3)
    expect(result.needsHuman).toBe(false)
    expect(result.toolExecutions).toHaveLength(3)
  })
})

describe('analyzeMessage — provider failure', () => {
  it('maps AI_PROVIDER_UNAVAILABLE to a controlled 502, never a raw error', async () => {
    const provider = makeFailingProvider(new AiProviderError('AI_PROVIDER_UNAVAILABLE', 'network down'))
    await expect(analyzeMessage(makeAuthContext('owner'), baseInput, { provider })).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_UNAVAILABLE',
    })
  })

  it('maps AI_CONFIGURATION_ERROR to a controlled 500', async () => {
    const provider = makeFailingProvider(new AiProviderError('AI_CONFIGURATION_ERROR', 'no key'))
    await expect(analyzeMessage(makeAuthContext('owner'), baseInput, { provider })).rejects.toMatchObject({
      statusCode: 500,
      code: 'AI_CONFIGURATION_ERROR',
    })
  })

  it('never leaks a raw provider error message to the thrown ApiError', async () => {
    const provider = makeFailingProvider(new Error('secret internal SDK stack trace with API key sk-xxxx'))
    try {
      await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
      expect.unreachable()
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('sk-xxxx')
    }
  })

  it('wraps an unexpected (non-AiProviderError) throw as a controlled 502', async () => {
    const provider = makeFailingProvider(new Error('boom'))
    await expect(analyzeMessage(makeAuthContext('owner'), baseInput, { provider })).rejects.toMatchObject({
      statusCode: 502,
      code: 'AI_PROVIDER_UNAVAILABLE',
    })
  })
})

describe('analyzeMessage — malformed provider result', () => {
  it('degrades to a safe fallback result (not a thrown error) when the provider output fails validation', async () => {
    const provider = makeStubProvider({ intent: 'NOT_A_REAL_INTENT', confidence: 2, answer: '' })
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.needsHuman).toBe(true)
    expect(result.intent).toBe('UNKNOWN')
    expect(result.confidence).toBe(0)
    expect(result.reason).toContain('AI_INVALID_RESPONSE')
  })

  it('degrades safely when the provider returns something that is not even an object', async () => {
    const provider = makeStubProvider('just a string, not JSON')
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.needsHuman).toBe(true)
  })
})

describe('analyzeMessage — confidence policy integration', () => {
  it('forces needsHuman = true when the provider reports low confidence but claims needsHuman = false', async () => {
    const provider = makeStubProvider(validRaw({ confidence: 0.2, needsHuman: false }))
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.needsHuman).toBe(true)
  })
})

describe('analyzeMessage — fabricated action safety', () => {
  it('overrides a draft that falsely claims an appointment was booked', async () => {
    const provider = makeStubProvider(validRaw({ answer: 'Я записал вас на завтра в 15:00.', needsHuman: false }))
    const result = await analyzeMessage(makeAuthContext('owner'), baseInput, { provider })
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('записал вас')
  })
})
