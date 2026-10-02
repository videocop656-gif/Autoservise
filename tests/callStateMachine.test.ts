import { describe, it, expect } from 'vitest'
import { applyCallEvent, recoveryFor, type CallState } from '../src/server/telephony/callStateMachine'
import type { NormalizedCallEvent } from '../src/server/telephony/types'

// MCR-2 — the call state machine is order-independent for the outcome: every
// permutation of the same set of events ends in the same outcome, and answer
// evidence always wins.

type Ev = Pick<NormalizedCallEvent, 'eventType' | 'wasAnswered' | 'occurredAt'>
const ev = (eventType: Ev['eventType'], wasAnswered: boolean | null = null): Ev => ({ eventType, wasAnswered, occurredAt: null })
const initial: CallState = { direction: 'INBOUND', remotePhoneE164: '+77011234567', outcome: 'IN_PROGRESS', startedAt: null, answeredAt: null, endedAt: null, outcomeDetectedAt: null }

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]))
}
const finalOutcome = (events: Ev[]) => events.reduce((s, e, i) => applyCallEvent(s, e, new Date(i * 1000)), initial).outcome

describe('callStateMachine — outcome is order-independent', () => {
  it.each([
    [[ev('RINGING'), ev('MISSED')], 'MISSED'],
    [[ev('RINGING'), ev('ANSWERED'), ev('COMPLETED', true)], 'ANSWERED'],
    [[ev('RINGING'), ev('COMPLETED', false)], 'MISSED'],
    [[ev('RINGING'), ev('MISSED'), ev('ANSWERED')], 'ANSWERED'],
    [[ev('RINGING'), ev('COMPLETED', null)], 'IN_PROGRESS'],
    [[ev('MISSED'), ev('COMPLETED', false), ev('RINGING')], 'MISSED'],
  ] as [Ev[], string][])('every order of %j ends %s', (events, expected) => {
    for (const order of permutations(events)) expect(finalOutcome(order)).toBe(expected)
  })

  it('outcomeDetectedAt is the receipt time of the event that set the current outcome; repeats keep it', () => {
    let s = applyCallEvent(initial, ev('RINGING'), new Date(1000))
    expect(s.outcomeDetectedAt).toBeNull()
    s = applyCallEvent(s, ev('MISSED'), new Date(2000))
    s = applyCallEvent(s, ev('MISSED'), new Date(3000))
    expect(s.outcomeDetectedAt).toEqual(new Date(2000))
  })

  it('recovery: READY only for a missed inbound call with a caller number', () => {
    expect(recoveryFor({ direction: 'INBOUND', outcome: 'MISSED', remotePhoneE164: '+77011234567' })).toEqual({ recoveryState: 'READY', recoveryIneligibleReason: null })
    expect(recoveryFor({ direction: 'INBOUND', outcome: 'MISSED', remotePhoneE164: null }).recoveryIneligibleReason).toBe('NO_CALLER_PHONE')
    expect(recoveryFor({ direction: 'INBOUND', outcome: 'ANSWERED', remotePhoneE164: '+77011234567' }).recoveryIneligibleReason).toBe('ANSWERED')
    expect(recoveryFor({ direction: 'OUTBOUND', outcome: 'MISSED', remotePhoneE164: '+77011234567' }).recoveryIneligibleReason).toBe('OUTBOUND')
    expect(recoveryFor({ direction: 'INBOUND', outcome: 'IN_PROGRESS', remotePhoneE164: '+77011234567' }).recoveryState).toBe('PENDING')
  })
})
