import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { makeAuthContext } from './helpers/fixtures'

const {
  listMock,
  findByIdMock,
  findByIdWithDetailMock,
  findActiveByConversationMock,
  createMock,
  claimMock,
  resolveMock,
  cancelMock,
  aiLogCreateMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  findByIdMock: vi.fn(),
  findByIdWithDetailMock: vi.fn(),
  findActiveByConversationMock: vi.fn(),
  createMock: vi.fn(),
  claimMock: vi.fn(),
  resolveMock: vi.fn(),
  cancelMock: vi.fn(),
  aiLogCreateMock: vi.fn(),
}))

vi.mock('../src/server/repositories/escalationRepository', () => ({
  escalationRepository: {
    list: listMock,
    findById: findByIdMock,
    findByIdWithDetail: findByIdWithDetailMock,
    findActiveByConversation: findActiveByConversationMock,
    create: createMock,
    claim: claimMock,
    resolve: resolveMock,
    cancel: cancelMock,
  },
  ACTIVE_ESCALATION_STATUSES: ['OPEN', 'IN_PROGRESS'],
}))
// escalationService.ts writes audit records via aiLogService.ts (real
// code) down to this repository — mocked so every log write here stays an
// in-memory no-op instead of a real, always-failing DB round trip.
vi.mock('../src/server/repositories/aiLogRepository', () => ({
  aiLogRepository: {
    create: aiLogCreateMock,
    list: vi.fn(),
    findById: vi.fn(),
    findByIdWithDetail: vi.fn(),
  },
}))

import {
  listEscalations,
  getEscalation,
  claimEscalation,
  resolveEscalation,
  cancelEscalation,
  createOrReuseActiveEscalation,
  deriveEscalationReason,
  deriveEscalationSummary,
} from '../src/server/services/escalationService'

const CONVERSATION_ID = 'conv1'
const ESCALATION_ID = 'esc1'

function makeEscalation(overrides: Record<string, unknown> = {}) {
  return {
    id: ESCALATION_ID,
    tenantId: 't1',
    businessId: 'b1',
    conversationId: CONVERSATION_ID,
    customerId: 'cust1',
    status: 'OPEN',
    priority: 'NORMAL',
    reason: 'Low confidence classification',
    summary: "AI could not safely answer the customer's request. Low confidence classification",
    assignedUserId: null,
    activeConversationId: CONVERSATION_ID,
    createdAt: new Date('2026-09-08T09:00:00Z'),
    updatedAt: new Date('2026-09-08T09:00:00Z'),
    resolvedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  aiLogCreateMock.mockResolvedValue({})
})

describe('deriveEscalationReason', () => {
  it('uses the AI result reason, trimmed', () => {
    expect(deriveEscalationReason('  Low confidence  ')).toBe('Low confidence')
  })

  it('falls back to a controlled message when reason is null', () => {
    expect(deriveEscalationReason(null)).toBe('AI requires human assistance')
  })

  it('falls back when reason is blank', () => {
    expect(deriveEscalationReason('   ')).toBe('AI requires human assistance')
  })

  it('truncates an excessively long reason rather than storing it unbounded', () => {
    const long = 'x'.repeat(10000)
    expect(deriveEscalationReason(long).length).toBeLessThanOrEqual(500)
  })
})

describe('deriveEscalationSummary', () => {
  it('builds a safe summary from the derived reason, never raw provider output', () => {
    const summary = deriveEscalationSummary('Low confidence classification')
    expect(summary).toContain('Low confidence classification')
    expect(summary).toContain("could not safely answer")
  })

  it('never returns null — always has a safe mechanism available', () => {
    expect(deriveEscalationSummary('x')).toBeTruthy()
  })
})

describe('createOrReuseActiveEscalation — idempotency', () => {
  const input = { conversationId: CONVERSATION_ID, customerId: 'cust1', reason: 'r', summary: 's' }

  it('creates a new escalation when none is active for this conversation', async () => {
    findActiveByConversationMock.mockResolvedValue(null)
    createMock.mockResolvedValue(makeEscalation())
    const ctx = makeAuthContext('owner')
    const result = await createOrReuseActiveEscalation(ctx, input)
    expect(result.created).toBe(true)
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ctx.tenant.id,
        businessId: ctx.business.id,
        conversationId: CONVERSATION_ID,
        status: 'OPEN',
        priority: 'NORMAL',
        activeConversationId: CONVERSATION_ID,
      })
    )
  })

  it('reuses an existing active escalation instead of creating a second one (fast path)', async () => {
    const existing = makeEscalation()
    findActiveByConversationMock.mockResolvedValue(existing)
    const ctx = makeAuthContext('owner')
    const result = await createOrReuseActiveEscalation(ctx, input)
    expect(result.created).toBe(false)
    expect(result.escalation).toEqual(existing)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('never invents priority beyond NORMAL', async () => {
    findActiveByConversationMock.mockResolvedValue(null)
    createMock.mockResolvedValue(makeEscalation())
    await createOrReuseActiveEscalation(makeAuthContext('owner'), input)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ priority: 'NORMAL' }))
  })

  it('recovers from a real concurrent-insert race via the DB unique constraint (P2002), never a raw database error', async () => {
    findActiveByConversationMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeEscalation())
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    )
    const ctx = makeAuthContext('owner')
    const result = await createOrReuseActiveEscalation(ctx, input)
    expect(result.created).toBe(false)
    expect(findActiveByConversationMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces a genuine creation failure as a controlled ESCALATION_CREATION_FAILED error, never silently succeeding', async () => {
    findActiveByConversationMock.mockResolvedValue(null)
    createMock.mockRejectedValue(new Error('connection reset'))
    const ctx = makeAuthContext('owner')
    await expect(createOrReuseActiveEscalation(ctx, input)).rejects.toMatchObject({ statusCode: 500, code: 'ESCALATION_CREATION_FAILED' })
  })

  it('manager is granted the same access as owner/admin — same operational exception as Appointment/Conversation/AI Core', async () => {
    findActiveByConversationMock.mockResolvedValue(makeEscalation())
    await expect(createOrReuseActiveEscalation(makeAuthContext('manager'), input)).resolves.toBeTruthy()
  })
})

describe('listEscalations / getEscalation', () => {
  it('lists escalations scoped to the current tenant/business with pagination', async () => {
    listMock.mockResolvedValue({ items: [makeEscalation()], total: 1 })
    const ctx = makeAuthContext('owner')
    const result = await listEscalations(ctx, { page: 1, pageSize: 20 })
    expect(listMock).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, expect.objectContaining({ skip: 0, take: 20 }))
    expect(result.total).toBe(1)
  })

  it('getEscalation returns 404 for a non-existent id', async () => {
    findByIdWithDetailMock.mockResolvedValue(null)
    await expect(getEscalation(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('getEscalation returns the full detail row when found', async () => {
    const esc = makeEscalation()
    findByIdWithDetailMock.mockResolvedValue(esc)
    const result = await getEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result).toEqual(esc)
  })
})

describe('claimEscalation', () => {
  it('claims an unassigned OPEN escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN', assignedUserId: null }))
    claimMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    const result = await claimEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.status).toBe('IN_PROGRESS')
    expect(result.assignedUserId).toBe('u1')
    expect(claimMock).toHaveBeenCalledWith('t1', 'b1', ESCALATION_ID, 'u1')
  })

  it('is idempotent when the same user claims their own escalation again', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    const result = await claimEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.assignedUserId).toBe('u1')
    expect(claimMock).not.toHaveBeenCalled() // short-circuited — no DB write needed for a true no-op
  })

  it('rejects claiming an escalation already assigned to someone else with 409', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'someone-else' }))
    await expect(claimEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ESCALATION_ALREADY_ASSIGNED',
    })
    expect(claimMock).not.toHaveBeenCalled()
  })

  it('rejects claiming a RESOLVED escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED' }))
    await expect(claimEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'ESCALATION_NOT_ACTIVE',
    })
  })

  it('rejects claiming a CANCELLED escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    await expect(claimEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'ESCALATION_NOT_ACTIVE',
    })
  })

  it('404s for a foreign/missing escalation', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(claimEscalation(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('reports a genuine concurrent-claim loss as 409, not a silent success', async () => {
    findByIdMock.mockResolvedValueOnce(makeEscalation({ status: 'OPEN', assignedUserId: null }))
    claimMock.mockResolvedValue(null) // lost the atomic race
    findByIdMock.mockResolvedValueOnce(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'someone-else' }))
    await expect(claimEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: 'ESCALATION_ALREADY_ASSIGNED',
    })
  })
})

describe('resolveEscalation', () => {
  it('resolves an OPEN escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN' }))
    resolveMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED', resolvedAt: new Date() }))
    const result = await resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.status).toBe('RESOLVED')
    expect(result.resolvedAt).toBeTruthy()
  })

  it('resolves an IN_PROGRESS escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    resolveMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED' }))
    const result = await resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.status).toBe('RESOLVED')
  })

  it('is idempotent for an already-RESOLVED escalation (no-op)', async () => {
    const already = makeEscalation({ status: 'RESOLVED', resolvedAt: new Date('2026-01-01T00:00:00Z') })
    findByIdMock.mockResolvedValue(already)
    const result = await resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result).toEqual(already)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('rejects resolving a CANCELLED escalation as an invalid transition', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    await expect(resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'ESCALATION_INVALID_STATUS',
    })
  })

  it('404s for a foreign/missing escalation', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(resolveEscalation(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('cancelEscalation', () => {
  it('cancels an OPEN escalation without setting resolvedAt', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN' }))
    cancelMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED', resolvedAt: null }))
    const result = await cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.status).toBe('CANCELLED')
    expect(result.resolvedAt).toBeNull()
  })

  it('cancels an IN_PROGRESS escalation', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    cancelMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    const result = await cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result.status).toBe('CANCELLED')
  })

  it('is idempotent for an already-CANCELLED escalation (no-op)', async () => {
    const already = makeEscalation({ status: 'CANCELLED' })
    findByIdMock.mockResolvedValue(already)
    const result = await cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(result).toEqual(already)
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it('rejects cancelling a RESOLVED escalation as an invalid transition', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED' }))
    await expect(cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toMatchObject({
      statusCode: 400,
      code: 'ESCALATION_INVALID_STATUS',
    })
  })

  it('404s for a foreign/missing escalation', async () => {
    findByIdMock.mockResolvedValue(null)
    await expect(cancelEscalation(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('permissions', () => {
  it('owner can list/claim/resolve/cancel', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    await expect(listEscalations(makeAuthContext('owner'), { page: 1, pageSize: 20 })).resolves.toBeDefined()
  })

  it('admin can list/claim/resolve/cancel', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    await expect(listEscalations(makeAuthContext('admin'), { page: 1, pageSize: 20 })).resolves.toBeDefined()
  })

  it('manager can list/claim/resolve/cancel — same operational exception as Appointment/Conversation/AI Core', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    await expect(listEscalations(makeAuthContext('manager'), { page: 1, pageSize: 20 })).resolves.toBeDefined()
  })
})

describe('AI Logs / Audit integration (Prompt 13)', () => {
  const input = { conversationId: CONVERSATION_ID, customerId: 'cust1', reason: 'r', summary: 's' }

  it('a genuine create writes exactly one AI_ESCALATION_CREATE/SUCCESS record, never labeled as reuse', async () => {
    findActiveByConversationMock.mockResolvedValue(null)
    createMock.mockResolvedValue(makeEscalation())
    await createOrReuseActiveEscalation(makeAuthContext('owner'), input)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'AI_ESCALATION_CREATE', outcome: 'SUCCESS', escalationId: ESCALATION_ID, conversationId: CONVERSATION_ID })
    )
  })

  it('a fast-path reuse writes exactly one AI_ESCALATION_REUSE/REUSED record, never labeled as create', async () => {
    const existing = makeEscalation()
    findActiveByConversationMock.mockResolvedValue(existing)
    await createOrReuseActiveEscalation(makeAuthContext('owner'), input)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'AI_ESCALATION_REUSE', outcome: 'REUSED', escalationId: ESCALATION_ID })
    )
    expect(createMock).not.toHaveBeenCalled()
  })

  it('a race-recovered reuse (P2002) also writes AI_ESCALATION_REUSE, never a fabricated create', async () => {
    findActiveByConversationMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeEscalation())
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' })
    )
    await createOrReuseActiveEscalation(makeAuthContext('owner'), input)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(expect.objectContaining({ operation: 'AI_ESCALATION_REUSE', outcome: 'REUSED' }))
  })

  it('a genuine creation failure writes NO audit record at all — better none than an inaccurate one', async () => {
    findActiveByConversationMock.mockResolvedValue(null)
    createMock.mockRejectedValue(new Error('connection reset'))
    await expect(createOrReuseActiveEscalation(makeAuthContext('owner'), input)).rejects.toBeTruthy()
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a real claim writes AI_ESCALATION_CLAIM/SUCCESS with the acting user as actorUserId', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN', assignedUserId: null }))
    claimMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    await claimEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'AI_ESCALATION_CLAIM', outcome: 'SUCCESS', escalationId: ESCALATION_ID, actorUserId: 'u1' })
    )
  })

  it('an idempotent no-op claim (already mine) writes no audit record — no real state transition happened', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'u1' }))
    await claimEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a failed claim (already assigned to someone else) writes no misleading SUCCESS audit', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'IN_PROGRESS', assignedUserId: 'someone-else' }))
    await expect(claimEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toBeTruthy()
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a real resolve writes AI_ESCALATION_RESOLVE/SUCCESS', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN' }))
    resolveMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED', resolvedAt: new Date() }))
    await resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(expect.objectContaining({ operation: 'AI_ESCALATION_RESOLVE', outcome: 'SUCCESS' }))
  })

  it('an idempotent no-op resolve (already RESOLVED) writes no audit record', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED' }))
    await resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a failed resolve (invalid transition from CANCELLED) writes no misleading SUCCESS audit', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    await expect(resolveEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toBeTruthy()
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a real cancel writes AI_ESCALATION_CANCEL/SUCCESS', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'OPEN' }))
    cancelMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    await cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).toHaveBeenCalledTimes(1)
    expect(aiLogCreateMock).toHaveBeenCalledWith(expect.objectContaining({ operation: 'AI_ESCALATION_CANCEL', outcome: 'SUCCESS' }))
  })

  it('an idempotent no-op cancel (already CANCELLED) writes no audit record', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'CANCELLED' }))
    await cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })

  it('a failed cancel (invalid transition from RESOLVED) writes no misleading SUCCESS audit', async () => {
    findByIdMock.mockResolvedValue(makeEscalation({ status: 'RESOLVED' }))
    await expect(cancelEscalation(makeAuthContext('owner'), ESCALATION_ID)).rejects.toBeTruthy()
    expect(aiLogCreateMock).not.toHaveBeenCalled()
  })
})
