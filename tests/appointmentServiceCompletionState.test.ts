import { describe, expect, it } from 'vitest'
import { serviceCompletionState } from '../src/components/appointments/shared'

// ---------------------------------------------------------------------------
// Prompt 33 — Service Completion Visibility.
//
// serviceCompletionState() is the pure classifier AppointmentDetailPanel
// uses to decide whether to show "Результат обслуживания не зафиксирован" /
// "...зафиксирован" — a plain, framework-free TypeScript function with no
// React/DOM dependency, so it can be unit-tested exactly like any other
// pure helper in tests/ (no frontend component-test framework is
// introduced here, consistent with this project's existing test
// infrastructure — see Prompt 31's Final Report).
//
// This directly covers spec §17's Test 1 and Test 2 scenarios, which have
// no backend equivalent (they're about UI classification, not persisted
// data), so a backend service test can't pin them the way it pins
// creation/tenant-isolation behavior.
// ---------------------------------------------------------------------------

describe('serviceCompletionState', () => {
  it('Test 1 — COMPLETED + a linked ServiceRecord exists -> recorded (no warning)', () => {
    expect(serviceCompletionState('COMPLETED', 1, false)).toBe('recorded')
    expect(serviceCompletionState('COMPLETED', 3, false)).toBe('recorded')
  })

  it('Test 2 — COMPLETED + no ServiceRecord -> missing (the gap is detected)', () => {
    expect(serviceCompletionState('COMPLETED', 0, false)).toBe('missing')
  })

  it('never guesses when the history lookup itself failed', () => {
    expect(serviceCompletionState('COMPLETED', 0, true)).toBe('unknown')
    expect(serviceCompletionState('COMPLETED', 3, true)).toBe('unknown')
  })

  it.each(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'] as const)(
    'the warning never applies to a non-COMPLETED status (%s), regardless of history',
    (status) => {
      expect(serviceCompletionState(status, 0, false)).toBe('not-applicable')
      expect(serviceCompletionState(status, 2, false)).toBe('not-applicable')
      expect(serviceCompletionState(status, 0, true)).toBe('not-applicable')
    }
  )
})
