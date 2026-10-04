import type { AiConversationTurn } from '@prisma/client'
import type { BusinessScope } from '../types/auth'
import { ApiError } from '../lib/errors'
import { logger } from '../lib/logger'
import type { AiProvider } from '../ai/provider'
import { tenantRepository } from '../repositories/tenantRepository'
import { messageRepository } from '../repositories/messageRepository'
import { conversationRepository } from '../repositories/conversationRepository'
import { aiTurnRepository } from '../repositories/aiTurnRepository'
import {
  AI_HANDOFF_NOTICE,
  AI_HANDOFF_REASON_TEXT,
  AI_MAX_CONSECUTIVE_AUTO_TURNS,
  AI_TURN_MAX_ATTEMPTS,
  isExplicitHumanRequest,
  type AiHandoffReason,
} from '../aiConversation/policy'
import { validateAutoReply } from '../aiConversation/replyValidation'
import { runAutoReplyAnalysis } from './aiService'
import { openOrReuseEscalation } from './escalationService'
import { deliverSystemMessage } from './channelDeliveryService'
import { logAiAnalyze } from './aiLogService'

// ---------------------------------------------------------------------------
// MCR-5 — Automatic AI conversation: one turn = one eligible inbound customer
// message.
//
//   claim (aiTurnRepository: lock, eligibility, per-conversation serialization,
//          coalescing of rapid messages)
//   → deterministic handoff checks (explicit "позовите человека", turn limit)
//   → the ONE AI core in 'auto_reply' mode (read-only availability only)
//   → server-side validation of the reply against business data (fail closed)
//   → finalize: re-check kill switch / pause / staff takeover / newer message
//     under the locks, then create ONE AI-origin Message (or the handoff
//     notice + durable pause)
//   → HANDOFF: open/reuse the escalation
//   → the existing ChannelDelivery core (deliverSystemMessage)
//   → COMPLETED / FAILED (retry re-delivers the SAME message, never a new text)
//
// Never: a Customer / Vehicle / CustomerRequest / Appointment write, a staff
// user, a booking. Scope = the turn's own tenant + business.
// ---------------------------------------------------------------------------

export type AiTurnOutcome = 'REPLIED' | 'HANDED_OFF' | 'SKIPPED' | 'BUSY' | 'FAILED' | 'NOT_FOUND'

export interface AiTurnDeps {
  provider?: AiProvider
  now?: Date
}

type Decision = { kind: 'REPLY'; content: string } | { kind: 'HANDOFF'; reason: AiHandoffReason; code?: string }

/** Runs (or resumes) the AI turn of one inbound message. Safe to call any number of times, concurrently. */
export async function processAiTurn(inboundMessageId: string, deps: AiTurnDeps = {}): Promise<AiTurnOutcome> {
  const now = deps.now ?? new Date()
  const claim = await aiTurnRepository.claim(inboundMessageId, now)
  if (claim.kind === 'NOT_FOUND') return 'NOT_FOUND'
  if (claim.kind === 'BUSY') return 'BUSY'
  if (claim.kind === 'SKIPPED') return 'SKIPPED'

  const { turn, conversation, business, inbound } = claim
  const tenant = await tenantRepository.findById(business.tenantId)
  if (!tenant) throw new Error('tenant missing for a claimed AI turn') // unreachable: FK
  const scope: BusinessScope = { tenant, business }

  // A retry of a turn that already created its message: deliver that same message.
  if (turn.replyMessageId) {
    if (turn.decision === 'HANDOFF') await ensureEscalation(scope, turn, (turn.reasonCode as AiHandoffReason | null) ?? 'AI_NEEDS_HUMAN')
    return deliver(scope, turn, turn.replyMessageId, turn.decision === 'HANDOFF' ? 'HANDED_OFF' : 'REPLIED')
  }

  let decision: Decision
  try {
    decision = await decide(scope, turn, conversation, inbound, deps)
  } catch (err) {
    // Provider / configuration failure: nothing for the customer. Bounded retry, then a person.
    const code = err instanceof ApiError ? err.code : 'AI_ERROR'
    logger.warn('ai_turn_generation_failed', { aiTurnId: turn.id, attempt: turn.attemptCount, code })
    if (turn.attemptCount < AI_TURN_MAX_ATTEMPTS) {
      await aiTurnRepository.transition(turn.id, turn.attemptCount, { state: 'FAILED', reasonCode: code })
      return 'FAILED'
    }
    decision = { kind: 'HANDOFF', reason: 'AI_FAILURE', code }
  }

  const finalized = await aiTurnRepository.finalize(
    turn.id,
    turn.attemptCount,
    decision.kind === 'REPLY'
      ? { decision: 'REPLY', content: decision.content }
      : { decision: 'HANDOFF', content: AI_HANDOFF_NOTICE, pauseReason: decision.reason, reasonCode: decision.reason },
    new Date()
  )
  if (finalized.kind === 'LOST_CLAIM') return 'SKIPPED'
  if (finalized.kind === 'SKIPPED') {
    logger.info('ai_turn_skipped_before_send', { aiTurnId: turn.id, reason: finalized.reason })
    return 'SKIPPED'
  }
  if (decision.kind === 'HANDOFF') {
    logger.info('ai_turn_handoff', { aiTurnId: turn.id, reason: decision.reason, code: decision.code ?? null })
    await ensureEscalation(scope, turn, decision.reason)
  }
  return deliver(scope, turn, finalized.messageId, decision.kind === 'HANDOFF' ? 'HANDED_OFF' : 'REPLIED')
}

async function decide(
  scope: BusinessScope,
  turn: AiConversationTurn,
  conversation: { id: string; customerId: string | null; customerRequestId: string | null; aiAutomationResumedAt: Date | null },
  inbound: { id: string; content: string; createdAt: Date },
  deps: AiTurnDeps
): Promise<Decision> {
  // 1. Deterministic safeguards first — no model call needed (and no cost).
  if (isExplicitHumanRequest(inbound.content)) return logDeterministicHandoff(scope, turn, 'CUSTOMER_REQUESTED_HUMAN')
  if ((await aiTurnRepository.countConsecutiveAiReplies(conversation)) >= AI_MAX_CONSECUTIVE_AUTO_TURNS) {
    return logDeterministicHandoff(scope, turn, 'TURN_LIMIT')
  }

  // 2. The AI core, on the bounded history BEFORE this message.
  const messages = await messageRepository.listByConversation(scope.tenant.id, scope.business.id, conversation.id)
  const index = messages.findIndex((m) => m.id === inbound.id)
  const before = index >= 0 ? messages.slice(0, index) : messages.filter((m) => m.createdAt < inbound.createdAt)
  const history = before.map((m) => ({ direction: m.direction, content: m.content }))
  const analysis = await runAutoReplyAnalysis(scope, conversation, { messageId: inbound.id, userMessage: inbound.content, history }, deps)

  // FAILED = no trustworthy model output (malformed / tool-call limit): same as a provider failure.
  if (analysis.outcome === 'FAILED') throw new ApiError(502, 'AI_INVALID_RESPONSE', 'AI response unusable')
  if (analysis.outcome === 'REJECTED') return { kind: 'HANDOFF', reason: 'UNSAFE_REPLY', code: 'AI_SAFETY_REJECTION' }
  if (analysis.result.needsHuman) {
    return { kind: 'HANDOFF', reason: analysis.result.reason === 'CUSTOMER_REQUESTED_HUMAN' ? 'CUSTOMER_REQUESTED_HUMAN' : 'AI_NEEDS_HUMAN' }
  }

  // 3. Fail closed: a reply the business data cannot back is never sent.
  const slots = (analysis.result.toolExecutions ?? [])
    .filter((t) => t.tool === 'check_availability' && t.success)
    .flatMap((t) => ((t.data as { slots?: { localStart: string }[] } | undefined)?.slots ?? []).map((s) => s.localStart))
  const customerTexts = [...before.filter((m) => m.direction === 'INBOUND').map((m) => m.content), inbound.content]
  const check = validateAutoReply(analysis.result.answer, { context: analysis.context, availabilitySlots: slots, customerTexts })
  if (!check.ok) return { kind: 'HANDOFF', reason: 'UNSAFE_REPLY', code: check.code }
  return { kind: 'REPLY', content: analysis.result.answer.trim() }
}

async function logDeterministicHandoff(scope: BusinessScope, turn: AiConversationTurn, reason: AiHandoffReason): Promise<Decision> {
  await logAiAnalyze(scope, {
    conversationId: turn.conversationId,
    messageId: turn.inboundMessageId,
    outcome: 'ESCALATED',
    needsHuman: true,
    reason,
    metadata: { mode: 'auto_reply', provider: 'none' },
  })
  return { kind: 'HANDOFF', reason }
}

async function ensureEscalation(scope: BusinessScope, turn: AiConversationTurn, reason: AiHandoffReason): Promise<void> {
  if (turn.escalationId) return
  const text = AI_HANDOFF_REASON_TEXT[reason] ?? AI_HANDOFF_REASON_TEXT.AI_NEEDS_HUMAN
  const conversation = await conversationRepository.findById(scope.tenant.id, scope.business.id, turn.conversationId)
  const { escalation } = await openOrReuseEscalation(scope, {
    conversationId: turn.conversationId,
    customerId: conversation?.customerId ?? null,
    reason: text,
    summary: `Автоматический AI передал диалог сотруднику. ${text}`,
  })
  if (escalation) await aiTurnRepository.setEscalation(turn.id, escalation.id)
}

async function deliver(scope: BusinessScope, turn: AiConversationTurn, messageId: string, success: 'REPLIED' | 'HANDED_OFF'): Promise<AiTurnOutcome> {
  const ids = { tenantId: scope.tenant.id, businessId: scope.business.id }
  try {
    const attempt = await deliverSystemMessage(ids, messageId)
    if (attempt.status === 'SENT') {
      await aiTurnRepository.transition(turn.id, turn.attemptCount, { state: 'COMPLETED', completedAt: new Date() })
      return success
    }
    // IN_PROGRESS: an earlier attempt may already have reached the provider — never resend blindly.
    const code = attempt.status === 'IN_PROGRESS' || attempt.status === 'UNCERTAIN' ? 'DELIVERY_UNCERTAIN' : 'DELIVERY_FAILED'
    await aiTurnRepository.transition(turn.id, turn.attemptCount, { state: 'FAILED', reasonCode: code })
    return 'FAILED'
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'DELIVERY_ERROR'
    await aiTurnRepository.transition(turn.id, turn.attemptCount, { state: 'FAILED', reasonCode: code })
    logger.warn('ai_turn_delivery_failed', { aiTurnId: turn.id, code })
    return 'FAILED'
  }
}

export interface AiTurnBatchSummary {
  processed: number
  replied: number
  handedOff: number
  skipped: number
  busy: number
  failed: number
}

/** One reconciliation pass (internal processor): every claimable turn, oldest first, each independently. */
export async function processPendingAiTurns(options: { limit?: number; now?: Date; provider?: AiProvider } = {}): Promise<AiTurnBatchSummary> {
  const now = options.now ?? new Date()
  const candidates = await aiTurnRepository.listClaimable(now, Math.min(Math.max(options.limit ?? 20, 1), 50))
  const summary: AiTurnBatchSummary = { processed: 0, replied: 0, handedOff: 0, skipped: 0, busy: 0, failed: 0 }
  for (const { inboundMessageId } of candidates) {
    const outcome = await processAiTurn(inboundMessageId, { now, provider: options.provider })
    summary.processed++
    if (outcome === 'REPLIED') summary.replied++
    else if (outcome === 'HANDED_OFF') summary.handedOff++
    else if (outcome === 'BUSY') summary.busy++
    else if (outcome === 'FAILED') summary.failed++
    else summary.skipped++
  }
  return summary
}
