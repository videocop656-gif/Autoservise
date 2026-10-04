import type { CallDirection, CallOutcome, CallRecoveryState } from '@prisma/client'
import type { NormalizedCallEvent } from './types'

// ---------------------------------------------------------------------------
// MCR-2 — the call state machine. Pure: (current state, one event, receipt
// time) → next state. Webhooks arrive in any order and can repeat, so the
// state only ever moves forward:
//
//   outcome rank  IN_PROGRESS (0) < MISSED (1) < ANSWERED (2)
//
//   RINGING                     → no outcome change (start time only)
//   ANSWERED                    → ANSWERED evidence
//   COMPLETED wasAnswered=true  → ANSWERED evidence
//   COMPLETED wasAnswered=false → MISSED evidence
//   COMPLETED wasAnswered=null  → end time only (no outcome claim)
//   MISSED                      → MISSED evidence
//   OBSERVED                    → nothing (MCR-8A: e.g. one leg of a group
//                                  call cancelled — another may have answered)
//
// The next outcome is the HIGHER of current and evidence: answer evidence is
// the strongest fact and nothing can turn an answered call into a missed one;
// a late "ringing" can't reopen a finished call; a late "answered" after
// "missed" corrects it to ANSWERED (a call that was answered was not missed).
// Provider times only ever widen the call: start = earliest seen, end/answer =
// first reported; they are never invented from receipt time.
// ---------------------------------------------------------------------------

export interface CallState {
  direction: CallDirection
  remotePhoneE164: string | null
  outcome: CallOutcome
  startedAt: Date | null
  answeredAt: Date | null
  endedAt: Date | null
  outcomeDetectedAt: Date | null
}

export type RecoveryIneligibleReason = 'ANSWERED' | 'OUTBOUND' | 'NO_CALLER_PHONE'

export interface CallRecovery {
  recoveryState: CallRecoveryState
  recoveryIneligibleReason: RecoveryIneligibleReason | null
}

const RANK: Record<CallOutcome, number> = { IN_PROGRESS: 0, MISSED: 1, ANSWERED: 2 }

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() <= b.getTime() ? a : b
}

function evidenceOf(event: Pick<NormalizedCallEvent, 'eventType' | 'wasAnswered'>): CallOutcome {
  switch (event.eventType) {
    case 'ANSWERED':
      return 'ANSWERED'
    case 'MISSED':
      return 'MISSED'
    case 'COMPLETED':
      return event.wasAnswered === true ? 'ANSWERED' : event.wasAnswered === false ? 'MISSED' : 'IN_PROGRESS'
    case 'RINGING':
    case 'OBSERVED':
      return 'IN_PROGRESS'
  }
}

/** Applies one (already de-duplicated) event. Never regresses the outcome. */
export function applyCallEvent(
  state: CallState,
  event: Pick<NormalizedCallEvent, 'eventType' | 'wasAnswered' | 'occurredAt' | 'callStartedAt' | 'callEndedAt'>,
  receivedAt: Date
): CallState {
  const evidence = evidenceOf(event)
  const outcome = RANK[evidence] > RANK[state.outcome] ? evidence : state.outcome
  const outcomeChanged = outcome !== state.outcome
  const at = event.occurredAt
  // OBSERVED claims nothing about the call — not even its end (one leg ended).
  if (event.eventType === 'OBSERVED') return { ...state, startedAt: earliest(state.startedAt, event.callStartedAt ?? null) }

  return {
    ...state,
    outcome,
    startedAt: earliest(earliest(state.startedAt, at), event.callStartedAt ?? null),
    answeredAt: event.eventType === 'ANSWERED' ? earliest(state.answeredAt, at) : state.answeredAt,
    endedAt: event.eventType === 'COMPLETED' || event.eventType === 'MISSED' ? (state.endedAt ?? event.callEndedAt ?? at) : state.endedAt,
    // When the CURRENT final outcome first became known to AUTOSERVISE.
    outcomeDetectedAt: outcomeChanged ? receivedAt : state.outcomeDetectedAt,
  }
}

/**
 * Conservative recovery eligibility. READY only for a finished INBOUND call
 * that was MISSED and has a usable caller number. Channel availability
 * (WhatsApp/SMS) is NOT decided here — that is the future router's job.
 */
export function recoveryFor(state: Pick<CallState, 'direction' | 'outcome' | 'remotePhoneE164'>): CallRecovery {
  if (state.direction === 'OUTBOUND') return { recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'OUTBOUND' }
  if (state.outcome === 'IN_PROGRESS') return { recoveryState: 'PENDING', recoveryIneligibleReason: null }
  if (state.outcome === 'ANSWERED') return { recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'ANSWERED' }
  if (!state.remotePhoneE164) return { recoveryState: 'NOT_ELIGIBLE', recoveryIneligibleReason: 'NO_CALLER_PHONE' }
  return { recoveryState: 'READY', recoveryIneligibleReason: null }
}
