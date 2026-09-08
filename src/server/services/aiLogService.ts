import type { Prisma, AiLogOperation, AiLogOutcome } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { logger } from '../lib/logger'
import { aiLogRepository } from '../repositories/aiLogRepository'
import type { PaginationParams } from '../lib/pagination'

// Read access: owner/admin/manager — same operational exception already
// established for Appointment/Conversation/AI Core/Escalation. No write
// endpoint exists for any role — see api/ai-logs/* (spec §"CLIENT INPUT").
const STAFF_ROLES = ['owner', 'admin', 'manager'] as const

const MAX_REASON_LENGTH = 500
const MAX_METADATA_VALUE_LENGTH = 200

/**
 * The only keys ever allowed into `metadata` (spec §"METADATA" /
 * §"DATA MINIMIZATION"). A genuinely useful new field must be added here
 * explicitly — this function is deliberately not "trust the caller,
 * strip obvious secrets," it's "nothing survives unless named."
 */
const ALLOWED_METADATA_KEYS = new Set([
  'provider',
  'toolCallCount',
  'errorCode',
  'statusCode',
  'confirmationRequired',
  'retryable',
])

function sanitizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_REASON_LENGTH)
}

/**
 * Every value written to `AiLog.metadata` passes through here first —
 * never a raw object handed straight to Prisma. Only whitelisted keys
 * survive, every value is coerced to a bounded primitive; objects, arrays,
 * functions, and anything else are silently dropped rather than nested in
 * (spec §"METADATA": "небольшие структурированные технические данные,"
 * never "raw provider response... full prompt... chain-of-thought").
 */
function sanitizeMetadata(metadata: Record<string, unknown> | undefined | null): Prisma.InputJsonObject | undefined {
  if (!metadata) return undefined
  // Prisma's InputJsonObject index signature is read-only, so this builds
  // on a plain mutable record first and only casts to the Prisma-facing
  // type at the end — the runtime shape is identical either way.
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
    // Anything else (object/array/etc.) is dropped, never nested in.
  }
  return Object.keys(safe).length > 0 ? (safe as Prisma.InputJsonObject) : undefined
}

/**
 * The one and only write path into AiLog — every logging function below
 * funnels through this. It NEVER throws: a logging failure must never
 * break the real business action it's describing (spec §"ATOMICITY TOOL +
 * LOG": guarantee the business action first, then attempt the audit
 * record; if the audit write itself fails, do not roll back the already-
 * successful action — controlled-log the audit failure instead, via the
 * existing structured `logger`, which already redacts anything
 * secret-shaped). Callers are fire-and-forget by design.
 */
async function writeLog(data: Prisma.AiLogUncheckedCreateInput): Promise<void> {
  try {
    await aiLogRepository.create(data)
  } catch (err) {
    logger.error('ai_log_write_failed', {
      operation: data.operation,
      outcome: data.outcome,
      conversationId: data.conversationId,
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

export interface LogAiAnalyzeInput {
  conversationId: string
  messageId?: string | null
  escalationId?: string | null
  outcome: AiLogOutcome
  intent?: string | null
  confidence?: number | null
  needsHuman?: boolean | null
  reason?: string | null
  metadata?: Record<string, unknown>
}

/** One row per completed analyze() call — never written for a provider/config failure that never produced any AiResult at all, only for one that did (even a degraded/fallback one) and was then classified into a safe outcome by aiService.ts. */
export async function logAiAnalyze(ctx: AuthContext, input: LogAiAnalyzeInput): Promise<void> {
  await writeLog({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId: input.conversationId,
    messageId: input.messageId ?? null,
    escalationId: input.escalationId ?? null,
    operation: 'AI_ANALYZE',
    outcome: input.outcome,
    intent: input.intent ?? null,
    confidence: input.confidence ?? null,
    needsHuman: input.needsHuman ?? null,
    reason: sanitizeReason(input.reason),
    metadata: sanitizeMetadata(input.metadata),
  })
}

export interface LogToolExecutionInput {
  conversationId: string | null
  toolName: string
  toolSuccess: boolean
  outcome: AiLogOutcome
  reason?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Called only for a genuine tool-execution attempt (spec §"LOG ONLY
 * ACTUAL TOOL EXECUTION") — the caller (aiService.ts) is responsible for
 * never calling this for a gate rejection (CONFIRMATION_REQUIRED,
 * schema-invalid input, a forbidden entity) where the real
 * appointmentService.ts function was never actually invoked. Never logs
 * raw tool arguments, customer PII, or a raw Prisma/appointment object —
 * only the tool's name and its already-sanitized ToolResult outcome.
 */
export async function logToolExecution(ctx: AuthContext, input: LogToolExecutionInput): Promise<void> {
  await writeLog({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId: input.conversationId,
    operation: 'AI_TOOL_EXECUTION',
    outcome: input.outcome,
    toolName: input.toolName,
    toolSuccess: input.toolSuccess,
    reason: sanitizeReason(input.reason),
    metadata: sanitizeMetadata(input.metadata),
  })
}

export interface LogEscalationEventInput {
  operation: Extract<AiLogOperation, 'AI_ESCALATION_CREATE' | 'AI_ESCALATION_REUSE'>
  conversationId: string
  escalationId: string
  reason?: string | null
}

/** Written from escalationService.createOrReuseActiveEscalation() only — the one place that genuinely knows whether a row was newly created or an existing active one was reused (spec §"ESCALATION LOGGING": never claim create when it was actually reuse). */
export async function logEscalationEvent(ctx: AuthContext, input: LogEscalationEventInput): Promise<void> {
  await writeLog({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId: input.conversationId,
    escalationId: input.escalationId,
    operation: input.operation,
    outcome: input.operation === 'AI_ESCALATION_CREATE' ? 'SUCCESS' : 'REUSED',
    reason: sanitizeReason(input.reason),
  })
}

export interface LogEscalationActionInput {
  operation: Extract<AiLogOperation, 'AI_ESCALATION_CLAIM' | 'AI_ESCALATION_RESOLVE' | 'AI_ESCALATION_CANCEL'>
  escalationId: string
  conversationId: string
}

/**
 * Written only for a genuinely successful staff action — never a failed
 * claim/resolve/cancel attempt, and never a no-op idempotent return (no
 * real state transition happened) (spec §"ESCALATION STAFF ACTIONS" /
 * §"FAILED ACTION"). `actorUserId` is always the authenticated caller,
 * never client-supplied. Never logs the session token, password, or any
 * other authentication material.
 */
export async function logEscalationAction(ctx: AuthContext, input: LogEscalationActionInput): Promise<void> {
  await writeLog({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    conversationId: input.conversationId,
    escalationId: input.escalationId,
    actorUserId: ctx.user.id,
    operation: input.operation,
    outcome: 'SUCCESS',
  })
}

export async function listAiLogs(
  ctx: AuthContext,
  opts: PaginationParams & {
    operation?: AiLogOperation
    outcome?: AiLogOutcome
    conversationId?: string
    escalationId?: string
    dateFrom?: Date
    dateTo?: Date
  }
) {
  requireRole(ctx, ...STAFF_ROLES)
  const skip = (opts.page - 1) * opts.pageSize
  return aiLogRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getAiLog(ctx: AuthContext, id: string) {
  requireRole(ctx, ...STAFF_ROLES)
  const log = await aiLogRepository.findByIdWithDetail(ctx.tenant.id, ctx.business.id, id)
  if (!log) {
    // Never reveal whether a foreign-tenant log exists (spec §"PERMISSIONS") — identical 404 either way.
    throw new ApiError(404, 'NOT_FOUND', 'AI log not found')
  }
  return log
}
