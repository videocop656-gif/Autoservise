import { describe, expect, it } from 'vitest'
import { addDaysToDateStr, appointmentDateRangeBounds, appointmentDateRangeLabel } from '../src/components/appointments/shared'

// ---------------------------------------------------------------------------
// Prompt 35 — Appointment List & Date Navigation UX.
//
// Pure calendar-date-string math, no Date/timezone mocking needed (these
// functions never touch `new Date()` or a live clock) — same convention as
// Prompt 33's appointmentServiceCompletionState.test.ts: a plain unit test
// over a framework-free frontend helper, no component-test infrastructure.
//
// 2026-09-14 is a Monday (confirmed: Date.UTC(2026,8,14) -> getUTCDay() 1),
// so it anchors every 'week'/'nextWeek' case at a clean week boundary.
// ---------------------------------------------------------------------------

describe('addDaysToDateStr', () => {
  it('adds days within a month', () => {
    expect(addDaysToDateStr('2026-09-14', 1)).toBe('2026-09-15')
  })

  it('rolls over a month boundary', () => {
    expect(addDaysToDateStr('2026-09-30', 1)).toBe('2026-10-01')
  })

  it('rolls over a year boundary', () => {
    expect(addDaysToDateStr('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('subtracts days (negative count)', () => {
    expect(addDaysToDateStr('2026-09-14', -1)).toBe('2026-09-13')
  })

  it('subtracting across a month boundary works too', () => {
    expect(addDaysToDateStr('2026-09-01', -1)).toBe('2026-08-31')
  })
})

describe('appointmentDateRangeBounds', () => {
  const MONDAY = '2026-09-14' // Monday
  const WEDNESDAY = '2026-09-16'
  const SUNDAY = '2026-09-20'

  it("'all' has no bounds — the pre-Prompt-35 default (no date filter) is preserved", () => {
    expect(appointmentDateRangeBounds('all', WEDNESDAY)).toBeNull()
  })

  it("'custom' has no derived bounds — the caller supplies its own from/to", () => {
    expect(appointmentDateRangeBounds('custom', WEDNESDAY)).toBeNull()
  })

  it("'today' is exactly [today, tomorrow)", () => {
    expect(appointmentDateRangeBounds('today', WEDNESDAY)).toEqual({ from: '2026-09-16', to: '2026-09-17' })
  })

  it("'tomorrow' is exactly [tomorrow, day-after-tomorrow)", () => {
    expect(appointmentDateRangeBounds('tomorrow', WEDNESDAY)).toEqual({ from: '2026-09-17', to: '2026-09-18' })
  })

  it("'week' anchored on a Monday starts on that same Monday", () => {
    expect(appointmentDateRangeBounds('week', MONDAY)).toEqual({ from: '2026-09-14', to: '2026-09-21' })
  })

  it("'week' anchored mid-week still resolves to that week's Monday..next Monday", () => {
    expect(appointmentDateRangeBounds('week', WEDNESDAY)).toEqual({ from: '2026-09-14', to: '2026-09-21' })
  })

  it("'week' anchored on a Sunday still belongs to the week that started the preceding Monday", () => {
    expect(appointmentDateRangeBounds('week', SUNDAY)).toEqual({ from: '2026-09-14', to: '2026-09-21' })
  })

  it("'nextWeek' is exactly the following Monday..Monday, regardless of which day this week `today` falls on", () => {
    expect(appointmentDateRangeBounds('nextWeek', MONDAY)).toEqual({ from: '2026-09-21', to: '2026-09-28' })
    expect(appointmentDateRangeBounds('nextWeek', WEDNESDAY)).toEqual({ from: '2026-09-21', to: '2026-09-28' })
    expect(appointmentDateRangeBounds('nextWeek', SUNDAY)).toEqual({ from: '2026-09-21', to: '2026-09-28' })
  })
})

describe('appointmentDateRangeLabel', () => {
  it("'all' (or a null bounds) reads as \"Все\"", () => {
    expect(appointmentDateRangeLabel('all', null)).toBe('Все')
    expect(appointmentDateRangeLabel('today', null)).toBe('Все')
  })

  it("'today' reads as \"Сегодня, <day month>\"", () => {
    expect(appointmentDateRangeLabel('today', { from: '2026-09-15', to: '2026-09-16' })).toBe('Сегодня, 15 сентября')
  })

  it("'tomorrow' reads as \"Завтра, <day month>\"", () => {
    expect(appointmentDateRangeLabel('tomorrow', { from: '2026-09-16', to: '2026-09-17' })).toBe('Завтра, 16 сентября')
  })

  it('a multi-day range reads as "<day month> — <day month>" using the INCLUSIVE end date', () => {
    expect(appointmentDateRangeLabel('week', { from: '2026-09-14', to: '2026-09-21' })).toBe('14 сентября — 20 сентября')
  })

  it('a single-day custom range collapses to one date instead of "X — X"', () => {
    expect(appointmentDateRangeLabel('custom', { from: '2026-09-16', to: '2026-09-17' })).toBe('16 сентября')
  })
})
