import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { escalationRepository } from '../repositories/escalationRepository'
import { logEscalationEvent, logEscalationAction } from './aiLogService'
import type { PaginationParams } from '../lib/pagination'
import type { AiEscalationStatus, AiEscalationPriority } from '@prisma/client'

// Owner/admin/manager all get identical access here — the same operational
// exception already established for Appointment/ServiceRecord/
// CustomerRequest/Conversation/AI Core (README.md "Roles"): this is
// day-to-day staff work, not a Settings change. Reassignment (Step 25) is
// deliberately not implemented — claiming is sufficient for this stage.
const STAFF_ROLES = ['owner', 'admin', 'manager'] as const

const MAX_REASON_LENGTH = 500
const MAX_SUMMARY_LENGTH = 1000
const FALLBACK_REASON = 'AI requires human assistance'

/**
 * Derives a safe, bounded reason string from the AI result's own `reason`
 * field only — never from raw customer text, never from provider
 * chain-of-thought (none is ever requested — see aiResult.schema.ts). If
 * the validated result has no reason at all, a fixed, controlled fallback
 * is used instead of leaving it empty (spec §"ESCALATION REASON").
 */
export function deriveEscalationReason(aiReason: string | null): string {
  const trimmed = aiReason?.trim()
  if (!trimmed) return FALLBACK_REASON
  return trimmed.slice(0, MAX_REASON_LENGTH)
}

/**
 * A safe, staff-facing convenience string built entirely from the already-
 * derived `reason` above — never the raw provider payload, never a prompt
 * (spec §"ESCALATION SUMMARY"). There is always a safe mechanism here (the
 * reason itself), so summary is never left null.
 */
export function deriveEscalationSummary(reason: string): string {
  return `AI could not safely answer the customer's request. ${reason}`.slice(0, MAX_SUMMARY_LENGTH)
}

export interface CreateEscalationFromAiInput {
  conversationId: string
  customerId: string | null
  reason: string
  summary: string | null
}

/**
 * The only way an escalation is ever created (spec §"AI INTEGRATION" /
 * §"CREATE API SECURITY") — there is no public POST endpoint for this at
 * all. Called exclusively from aiService.ts, after the AI result has
 * already passed structural validation and the safety layer, with
 * `reason`/`summary` already derived (never raw client or model text) by
 * the functions above.
 *
 * Idempotency (spec §"ESCALATION UNIQUENESS"): a fast-path read reuses an
 * already-active escalation for this conversation without ever touching
 * the database's write path. The real guarantee against a race between two
 * concurrent `analyze()` calls for the same conversation is the database
 * itself — `AiEscalation.activeConversationId` carries a `@@unique(
 * [tenantId, businessId, activeConversationId])` constraint (see
 * schema.prisma) that can never be represented as a partial/filtered index
 * in Prisma's schema DSL, so this nullable-column technique is the
 * fully-declarative equivalent. If two requests both pass the fast-path
 * check and both attempt to insert, Postgres accepts exactly one and
 * rejects the other with a unique-constraint violation (P2002); that
 * rejection is caught below and turned into a normal "reuse the existing
 * one" outcome — never a raw database error, never a duplicate row.
 */
export async function createOrReuseActiveEscalation(
  ctx: AuthContext,
  input: CreateEscalationFromAiInput
): Promise<{ escalation: Awaited<ReturnType<typeof escalationRepository.findById>>; created: boolean }> {
  // Defense in depth, same convention as appointmentService.ts's
  // createAppointment/updateAppointment: every mutating service function
  // independently re-checks the role, even though its only caller
  // (aiService.ts's analyzeMessage) already did so upstream.
  requireRole(ctx, ...STAFF_ROLES)

  const active = await escalationRepository.findActiveByConversation(ctx.tenant.id, ctx.business.id, input.conversationId)
  if (active) {
    // AI_ESCALATION_REUSE (Prompt 13) — this is the one place that
    // genuinely knows it's a reuse, not a create; never logged as
    // AI_ESCALATION_CREATE (spec §"ESCALATION LOGGING").
    await logEscalationEvent(ctx, {
      operation: 'AI_ESCALATION_REUSE',
      conversationId: input.conversationId,
      escalationId: active.id,
      reason: input.reason,
    })
    return { escalation: active, created: false }
  }

  try {
    const created = await escalationRepository.create({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      conversationId: input.conversationId,
      customerId: input.customerId,
      status: 'OPEN',
      priority: 'NORMAL', // spec §"PRIORITY": no safe elevation signal exists yet — NORMAL for every AI-created escalation, never hallucinated urgency.
      reason: input.reason,
      summary: input.summary,
      activeConversationId: input.conversationId,
    })
    await logEscalationEvent(ctx, {
      operation: 'AI_ESCALATION_CREATE',
      conversationId: input.conversationId,
      escalationId: created.id,
      reason: input.reason,
    })
    return { escalation: created, created: true }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const nowActive = await escalationRepository.findActiveByConversation(ctx.tenant.id, ctx.business.id, input.conversationId)
      if (nowActive) {
        // Lost a genuine concurrent-insert race — this really is a reuse from this call's perspective (spec §"CONCURRENT CREATION").
        await logEscalationEvent(ctx, {
          operation: 'AI_ESCALATION_REUSE',
          conversationId: input.conversationId,
          escalationId: nowActive.id,
          reason: input.reason,
        })
        return { escalation: nowActive, created: false }
      }
    }
    // Spec §"ESCALATION CREATION MUST BE TRANSACTION-SAFE": never silently
    // report needsHuman=true while pretending an escalation exists — a
    // genuine creation failure is a controlled application error, not a
    // swallowed one, and never exposes the raw database error. Deliberately
    // not logged as AI_ESCALATION_CREATE/FAILED: there is no escalation row
    // and no conversationId-scoped fact to safely and unambiguously record
    // beyond what the thrown 500 itself already communicates to the caller.
    throw new ApiError(500, 'ESCALATION_CREATION_FAILED', 'Failed to create escalation')
  }
}

export async function listEscalations(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: AiEscalationStatus
    priority?: AiEscalationPriority
    assignedUserId?: string
    unassignedOnly?: boolean
    customerId?: string
    conversationId?: string
  }
) {
  requireRole(ctx, ...STAFF_ROLES)
  const skip = (opts.page - 1) * opts.pageSize
  return escalationRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getEscalation(ctx: AuthContext, id: string) {
  requireRole(ctx, ...STAFF_ROLES)
  const escalation = await escalationRepository.findByIdWithDetail(ctx.tenant.id, ctx.business.id, id)
  if (!escalation) {
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  return escalation
}

/**
 * Atomic claim (spec §"CLAIM"/§"ASSIGNMENT"). Idempotent for the same
 * user re-claiming their own escalation; a 409 for anyone trying to take
 * an escalation someone else already holds — never a silent reassignment.
 */
export async function claimEscalation(ctx: AuthContext, id: string) {
  requireRole(ctx, ...STAFF_ROLES)

  const existing = await escalationRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  if (existing.status === 'RESOLVED' || existing.status === 'CANCELLED') {
    throw new ApiError(400, 'ESCALATION_NOT_ACTIVE', `Cannot claim a ${existing.status.toLowerCase()} escalation`)
  }
  if (existing.assignedUserId && existing.assignedUserId === ctx.user.id) {
    return existing // already mine — idempotent, no-op
  }
  if (existing.assignedUserId && existing.assignedUserId !== ctx.user.id) {
    throw new ApiError(409, 'ESCALATION_ALREADY_ASSIGNED', 'This escalation is already claimed by another staff member')
  }

  const claimed = await escalationRepository.claim(ctx.tenant.id, ctx.business.id, id, ctx.user.id)
  if (!claimed) {
    // Lost a genuine race against another concurrent claim — re-read for an honest, current answer rather than a stale guess.
    const latest = await escalationRepository.findById(ctx.tenant.id, ctx.business.id, id)
    if (latest?.assignedUserId === ctx.user.id) return latest
    throw new ApiError(409, 'ESCALATION_ALREADY_ASSIGNED', 'This escalation is already claimed by another staff member')
  }
  // Logged only for this genuine, real state transition (spec §"ESCALATION
  // STAFF ACTIONS") — never for the idempotent "already mine" early return
  // above, since no actual write happened there.
  await logEscalationAction(ctx, { operation: 'AI_ESCALATION_CLAIM', escalationId: claimed.id, conversationId: claimed.conversationId })
  return claimed
}

/** OPEN or IN_PROGRESS -> RESOLVED only (spec §"RESOLUTION"); already-RESOLVED is a no-op, CANCELLED is a rejected invalid transition — same "from === to is always a no-op" convention as appointmentService.ts. */
export async function resolveEscalation(ctx: AuthContext, id: string) {
  requireRole(ctx, ...STAFF_ROLES)

  const existing = await escalationRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  if (existing.status === 'RESOLVED') {
    return existing // idempotent, no-op
  }
  if (existing.status === 'CANCELLED') {
    throw new ApiError(400, 'ESCALATION_INVALID_STATUS', 'Cannot resolve a cancelled escalation')
  }

  const resolved = await escalationRepository.resolve(ctx.tenant.id, ctx.business.id, id)
  if (!resolved) {
    // Became terminal between our read and the atomic update (e.g. cancelled concurrently) — 404 is honest and matches the rest of the app's "not found = not currently mutable this way" convention.
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  // Real transition only (spec §"ESCALATION STAFF ACTIONS") — never for the idempotent "already RESOLVED" early return above.
  await logEscalationAction(ctx, { operation: 'AI_ESCALATION_RESOLVE', escalationId: resolved.id, conversationId: resolved.conversationId })
  return resolved
}

/** OPEN or IN_PROGRESS -> CANCELLED only (spec §"CANCELLATION"); already-CANCELLED is a no-op, RESOLVED is a rejected invalid transition. Deliberately never sets resolvedAt — see schema.prisma's AiEscalation.resolvedAt comment. */
export async function cancelEscalation(ctx: AuthContext, id: string) {
  requireRole(ctx, ...STAFF_ROLES)

  const existing = await escalationRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  if (existing.status === 'CANCELLED') {
    return existing // idempotent, no-op
  }
  if (existing.status === 'RESOLVED') {
    throw new ApiError(400, 'ESCALATION_INVALID_STATUS', 'Cannot cancel a resolved escalation')
  }

  const cancelled = await escalationRepository.cancel(ctx.tenant.id, ctx.business.id, id)
  if (!cancelled) {
    throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
  }
  // Real transition only (spec §"ESCALATION STAFF ACTIONS") — never for the idempotent "already CANCELLED" early return above.
  await logEscalationAction(ctx, { operation: 'AI_ESCALATION_CANCEL', escalationId: cancelled.id, conversationId: cancelled.conversationId })
  return cancelled
}
