import type { CallOutcome, CallRecoveryState } from '@prisma/client'
import { runInTransaction } from '../db/transaction'
import { normalizePhone } from '../lib/phone'
import { businessPhoneNumberRepository } from '../repositories/businessPhoneNumberRepository'
import { businessRepository } from '../repositories/businessRepository'
import { customerRepository } from '../repositories/customerRepository'
import { callInteractionRepository } from '../repositories/callInteractionRepository'
import { applyCallEvent, recoveryFor, type CallState } from '../telephony/callStateMachine'
import { publishRecoveryJob, type RecoveryJobPublishStatus } from '../recovery/recoveryJobs'
import type { NormalizedCallEvent } from '../telephony/types'

// ---------------------------------------------------------------------------
// MCR-2 — Missed Call Intake. One normalized provider event in, one durable
// CallInteraction per call out. Nothing else: no message, no delivery, no
// conversation, no AI, no request, no appointment, no notification. The
// recovery engine (MCR-4) picks up calls left in recoveryState READY.
//
// MCR-4.1 — after the transaction COMMITS, a call that is READY gets its
// durable recovery job published (Vercel Queues; see recovery/recoveryJobs).
// Postgres and the queue can't commit atomically, so the order is: READY is
// durable first, the job second. A failed publish leaves the call READY
// (recovered by the internal processor) and is reported as
// recoveryJob: 'PUBLISH_FAILED' so the webhook can ask the provider to retry;
// the retried (duplicate) event re-publishes with the same idempotency key.
//
// Tenant routing comes ONLY from the business-side number (the called number
// of an inbound call) → the one ACTIVE BusinessPhoneNumber holding it
// (globally unique). The caller's number never selects a tenant; the payload
// cannot name one (NormalizedCallEvent has no such field).
//
// No AuthContext and no fake user: a webhook is not a staff member. The
// routing result (tenantId + businessId) scopes every query; the audit trail
// is the CallInteraction's own timestamps plus the CallEvent ledger.
// ---------------------------------------------------------------------------

export type CallIntakeErrorCode = 'UNROUTABLE_NUMBER' | 'CALL_ROUTING_CONFLICT'

/** A permanent, classified refusal — nothing was written. */
export class CallIntakeError extends Error {
  constructor(readonly code: CallIntakeErrorCode) {
    super(code)
  }
}

export interface CallIntakeResult {
  status: 'accepted' | 'duplicate'
  callInteractionId: string
  outcome: CallOutcome
  recoveryState: CallRecoveryState
  /** MCR-4.1 — NOT_REQUIRED unless the committed state is READY. */
  recoveryJob: RecoveryJobPublishStatus | 'NOT_REQUIRED'
}

export async function ingestCallEvent(event: NormalizedCallEvent, receivedAt: Date = new Date()): Promise<CallIntakeResult> {
  const committed = await recordCallEvent(event, receivedAt)
  // Also on a duplicate event that finds the call still READY: that is the
  // provider retrying after an earlier publish failure. Any later state
  // (CLAIMED / SENT / NOT_ELIGIBLE / …) means there is nothing to trigger.
  if (committed.recoveryState !== 'READY') return { ...committed, recoveryJob: 'NOT_REQUIRED' }
  return { ...committed, recoveryJob: await publishRecoveryJob(committed.callInteractionId) }
}

async function recordCallEvent(event: NormalizedCallEvent, receivedAt: Date): Promise<Omit<CallIntakeResult, 'recoveryJob'>> {
  // 1. Route: the business-side number must be international (E.164) as the
  //    provider sends it — no default region exists before the tenant is known.
  const businessSide = event.direction === 'INBOUND' ? event.calledPhone : event.callerPhone
  const remoteSide = event.direction === 'INBOUND' ? event.callerPhone : event.calledPhone
  const businessE164 = normalizePhone(businessSide, null)
  if (!businessE164) throw new CallIntakeError('UNROUTABLE_NUMBER')

  const number = await businessPhoneNumberRepository.findActiveByPhoneE164ForRouting(businessE164)
  if (!number || !number.isActive) throw new CallIntakeError('UNROUTABLE_NUMBER')
  const business = await businessRepository.findFirstByTenant(number.tenantId)
  if (!business || business.id !== number.businessId) throw new CallIntakeError('UNROUTABLE_NUMBER')
  const tenantId = number.tenantId
  const businessId = number.businessId

  // 2. The other party (MCR-1 normalization, the business's region). Hidden,
  //    anonymous or invalid → null: the call is still recorded, never linked.
  const remotePhoneE164 = normalizePhone(remoteSide, business.phoneRegion)

  // 3. Existing customer — exactly one active match in THIS business, else none.
  //    Never created, never merged. Only used if this event creates the record.
  let customerId: string | null = null
  if (remotePhoneE164) {
    const matches = await customerRepository.findActiveByPhoneE164(tenantId, businessId, remotePhoneE164)
    if (matches.length === 1) customerId = matches[0]!.id
  }

  return runInTransaction(async (tx) => {
    // 4. One record per call: insert if absent, then lock it — concurrent
    //    events of the same call queue here and apply one at a time.
    await callInteractionRepository.insertIfAbsent(
      {
        tenantId,
        businessId,
        businessPhoneNumberId: number.id,
        provider: event.provider,
        providerCallId: event.providerCallId,
        direction: event.direction,
        remotePhoneE164,
        customerId,
        firstEventReceivedAt: receivedAt,
        lastEventReceivedAt: receivedAt,
        ...recoveryFor({ direction: event.direction, outcome: 'IN_PROGRESS', remotePhoneE164 }),
      },
      tx
    )
    const call = await callInteractionRepository.lockByProviderCall(event.provider, event.providerCallId, tx)
    if (!call) throw new Error('call interaction missing after insert') // unreachable: inserted or existed
    if (call.tenantId !== tenantId || call.businessId !== businessId) {
      // The provider call id already belongs to another business: never move or merge it.
      throw new CallIntakeError('CALL_ROUTING_CONFLICT')
    }

    // 5. Each provider event takes effect once.
    const fresh = await callInteractionRepository.insertEventIfAbsent(
      {
        tenantId,
        businessId,
        callInteractionId: call.id,
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        receivedAt,
      },
      tx
    )
    if (!fresh) {
      return { status: 'duplicate', callInteractionId: call.id, outcome: call.outcome, recoveryState: call.recoveryState }
    }

    // 6. Monotonic state transition + eligibility.
    const current: CallState = {
      direction: call.direction,
      remotePhoneE164: call.remotePhoneE164,
      outcome: call.outcome,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
      outcomeDetectedAt: call.outcomeDetectedAt,
    }
    const next = applyCallEvent(current, event, receivedAt)
    // MCR-4 — once the recovery engine owns the call (CLAIMED / SENT / FAILED
    // / SUPPRESSED) intake never rewrites its recovery state: a late ANSWERED
    // still updates the call's outcome, and the engine re-checks that outcome
    // before any send (and on every retry), so it won't message an answered
    // caller. Only the pre-engine states are recomputed here.
    const engineOwned = !['PENDING', 'READY', 'NOT_ELIGIBLE'].includes(call.recoveryState)
    const recovery = engineOwned ? { recoveryState: call.recoveryState, recoveryIneligibleReason: call.recoveryIneligibleReason } : recoveryFor(next)
    const updated = await callInteractionRepository.update(
      call.id,
      {
        outcome: next.outcome,
        startedAt: next.startedAt,
        answeredAt: next.answeredAt,
        endedAt: next.endedAt,
        outcomeDetectedAt: next.outcomeDetectedAt,
        lastEventReceivedAt: receivedAt.getTime() > call.lastEventReceivedAt.getTime() ? receivedAt : call.lastEventReceivedAt,
        recoveryState: recovery.recoveryState,
        recoveryIneligibleReason: recovery.recoveryIneligibleReason,
      },
      tx
    )
    return { status: 'accepted', callInteractionId: updated.id, outcome: updated.outcome, recoveryState: updated.recoveryState }
  })
}
