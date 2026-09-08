import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const { createMock, listMock, findByIdWithDetailMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  findByIdWithDetailMock: vi.fn(),
}))

vi.mock('../src/server/repositories/aiLogRepository', () => ({
  aiLogRepository: {
    create: createMock,
    list: listMock,
    findById: vi.fn(),
    findByIdWithDetail: findByIdWithDetailMock,
  },
}))

import {
  logAiAnalyze,
  logToolExecution,
  logEscalationEvent,
  logEscalationAction,
  listAiLogs,
  getAiLog,
} from '../src/server/services/aiLogService'

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({})
})

describe('logAiAnalyze — data minimization', () => {
  it('writes tenantId/businessId from ctx, never from input', async () => {
    const ctx = makeAuthContext('owner')
    await logAiAnalyze(ctx, { conversationId: 'conv1', outcome: 'SUCCESS' })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id, operation: 'AI_ANALYZE', outcome: 'SUCCESS' })
    )
  })

  it('carries intent/confidence/needsHuman/reason through unchanged (within bounds)', async () => {
    const ctx = makeAuthContext('owner')
    await logAiAnalyze(ctx, {
      conversationId: 'conv1',
      outcome: 'ESCALATED',
      intent: 'VEHICLE_PROBLEM',
      confidence: 0.42,
      needsHuman: true,
      reason: 'Low confidence classification',
    })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'VEHICLE_PROBLEM', confidence: 0.42, needsHuman: true, reason: 'Low confidence classification' })
    )
  })

  it('truncates an excessively long reason to 500 chars, never storing it unbounded', async () => {
    const ctx = makeAuthContext('owner')
    const longReason = 'x'.repeat(10000)
    await logAiAnalyze(ctx, { conversationId: 'conv1', outcome: 'SUCCESS', reason: longReason })
    const call = createMock.mock.calls[0]![0] as { reason: string }
    expect(call.reason.length).toBeLessThanOrEqual(500)
  })

  it('never persists a value under a metadata key it does not explicitly allow', async () => {
    const ctx = makeAuthContext('owner')
    await logAiAnalyze(ctx, {
      conversationId: 'conv1',
      outcome: 'SUCCESS',
      metadata: {
        provider: 'mock',
        toolCallCount: 1,
        systemPrompt: 'YOU ARE A HELPFUL AI...leaked chain-of-thought',
        rawProviderResponse: { choices: [{ message: { content: 'raw' } }] },
        apiKey: 'sk-secret',
        sessionCookie: 'abc123',
      },
    })
    const call = createMock.mock.calls[0]![0] as { metadata: Record<string, unknown> }
    expect(call.metadata).toEqual({ provider: 'mock', toolCallCount: 1 })
    expect(JSON.stringify(call.metadata)).not.toContain('chain-of-thought')
    expect(JSON.stringify(call.metadata)).not.toContain('sk-secret')
    expect(JSON.stringify(call.metadata)).not.toContain('sessionCookie')
    expect(JSON.stringify(call.metadata)).not.toContain('abc123')
  })

  it('never nests an object/array value into metadata, even under an allowed key name coincidence', async () => {
    const ctx = makeAuthContext('owner')
    await logAiAnalyze(ctx, {
      conversationId: 'conv1',
      outcome: 'SUCCESS',
      metadata: { provider: { nested: 'object, should be dropped' } as unknown as string },
    })
    const call = createMock.mock.calls[0]![0] as { metadata: Record<string, unknown> | undefined }
    expect(call.metadata).toBeUndefined()
  })

  it('omits metadata entirely rather than writing an empty object when nothing survives sanitization', async () => {
    const ctx = makeAuthContext('owner')
    await logAiAnalyze(ctx, { conversationId: 'conv1', outcome: 'SUCCESS', metadata: { notAllowed: 'x' } })
    const call = createMock.mock.calls[0]![0] as { metadata: unknown }
    expect(call.metadata).toBeUndefined()
  })

  it('a write failure is caught and never propagates to the caller', async () => {
    createMock.mockRejectedValue(new Error('connection reset'))
    const ctx = makeAuthContext('owner')
    await expect(logAiAnalyze(ctx, { conversationId: 'conv1', outcome: 'SUCCESS' })).resolves.toBeUndefined()
  })
})

describe('logToolExecution', () => {
  it('records toolName/toolSuccess/outcome, scoped to tenant/business', async () => {
    const ctx = makeAuthContext('owner')
    await logToolExecution(ctx, { conversationId: 'conv1', toolName: 'create_appointment', toolSuccess: true, outcome: 'SUCCESS' })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ctx.tenant.id,
        businessId: ctx.business.id,
        operation: 'AI_TOOL_EXECUTION',
        toolName: 'create_appointment',
        toolSuccess: true,
        outcome: 'SUCCESS',
      })
    )
  })

  it('never persists raw tool arguments even if accidentally passed in metadata', async () => {
    const ctx = makeAuthContext('owner')
    await logToolExecution(ctx, {
      conversationId: 'conv1',
      toolName: 'create_appointment',
      toolSuccess: false,
      outcome: 'FAILED',
      metadata: { errorCode: 'APPOINTMENT_CONFLICT', rawArguments: { customerId: 'c1', phone: '+7900', notes: 'sensitive' } },
    })
    const call = createMock.mock.calls[0]![0] as { metadata: Record<string, unknown> }
    expect(call.metadata).toEqual({ errorCode: 'APPOINTMENT_CONFLICT' })
    expect(JSON.stringify(call.metadata)).not.toContain('sensitive')
    expect(JSON.stringify(call.metadata)).not.toContain('+7900')
  })
})

describe('logEscalationEvent', () => {
  it('AI_ESCALATION_CREATE maps to outcome SUCCESS', async () => {
    const ctx = makeAuthContext('owner')
    await logEscalationEvent(ctx, { operation: 'AI_ESCALATION_CREATE', conversationId: 'conv1', escalationId: 'esc1' })
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ operation: 'AI_ESCALATION_CREATE', outcome: 'SUCCESS', escalationId: 'esc1' }))
  })

  it('AI_ESCALATION_REUSE maps to outcome REUSED, never SUCCESS — must never claim create when it was reuse', async () => {
    const ctx = makeAuthContext('owner')
    await logEscalationEvent(ctx, { operation: 'AI_ESCALATION_REUSE', conversationId: 'conv1', escalationId: 'esc1' })
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ operation: 'AI_ESCALATION_REUSE', outcome: 'REUSED' }))
  })
})

describe('logEscalationAction', () => {
  it('records actorUserId from ctx.user.id, never from client input', async () => {
    const ctx = makeAuthContext('manager', { user: { ...makeAuthContext('manager').user, id: 'staff-42' } })
    await logEscalationAction(ctx, { operation: 'AI_ESCALATION_CLAIM', escalationId: 'esc1', conversationId: 'conv1' })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'AI_ESCALATION_CLAIM', actorUserId: 'staff-42', outcome: 'SUCCESS' })
    )
  })

  it('never logs a session token, password hash, or other auth material', async () => {
    const ctx = makeAuthContext('owner')
    await logEscalationAction(ctx, { operation: 'AI_ESCALATION_RESOLVE', escalationId: 'esc1', conversationId: 'conv1' })
    const call = createMock.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(call)).not.toContain('sessionId')
    expect(Object.keys(call)).not.toContain('passwordHash')
    expect(Object.keys(call)).not.toContain('token')
  })
})

describe('listAiLogs / getAiLog — permissions and tenant isolation', () => {
  it('owner/admin/manager can all list', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(listAiLogs(makeAuthContext(role), { page: 1, pageSize: 20 })).resolves.toBeDefined()
    }
  })

  it('list is scoped to the requesting tenant/business', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    const ctx = makeAuthContext('owner')
    await listAiLogs(ctx, { page: 1, pageSize: 20 })
    expect(listMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, expect.objectContaining({ skip: 0, take: 20 }))
  })

  it('getAiLog returns 404 for a missing/foreign-tenant log — never reveals existence', async () => {
    findByIdWithDetailMock.mockResolvedValue(null)
    await expect(getAiLog(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('getAiLog returns the full detail row when found, scoped to tenant/business', async () => {
    const row = { id: 'log1', operation: 'AI_ANALYZE', outcome: 'SUCCESS' }
    findByIdWithDetailMock.mockResolvedValue(row)
    const ctx = makeAuthContext('owner')
    const result = await getAiLog(ctx, 'log1')
    expect(result).toEqual(row)
    expect(findByIdWithDetailMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, 'log1')
  })
})
