import { describe, it, expect } from 'vitest'
import {
  peakConcurrency,
  capacitySnapshot,
  consumesCapacity,
  CAPACITY_CONSUMING_STATUSES,
} from '../src/server/domain/capacity'
import { CONFLICT_BLOCKING_STATUSES } from '../src/server/repositories/appointmentRepository'

// Prompt 50 — the canonical capacity math (half-open [start, end), peak
// concurrency). Times are UTC; local-time behaviour is covered in
// appointmentCapacity.test.ts.

const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00Z`)
const iv = (from: string, to: string) => ({ startAt: at(from), endAt: at(to) })

describe('statuses consuming capacity', () => {
  it('SCHEDULED, CONFIRMED and IN_PROGRESS consume a post', () => {
    expect(consumesCapacity('SCHEDULED')).toBe(true)
    expect(consumesCapacity('CONFIRMED')).toBe(true)
    expect(consumesCapacity('IN_PROGRESS')).toBe(true)
  })

  it('COMPLETED, CANCELLED and NO_SHOW do not', () => {
    expect(consumesCapacity('COMPLETED')).toBe(false)
    expect(consumesCapacity('CANCELLED')).toBe(false)
    expect(consumesCapacity('NO_SHOW')).toBe(false)
  })

  it('is exactly the set that blocks a vehicle — one definition of "active"', () => {
    expect([...CONFLICT_BLOCKING_STATUSES].sort()).toEqual([...CAPACITY_CONSUMING_STATUSES].sort())
  })
})

describe('peakConcurrency — half-open [start, end)', () => {
  it('no appointments → 0', () => {
    expect(peakConcurrency([], at('10:00'), at('11:00'))).toBe(0)
  })

  it('an adjacent appointment (ends exactly at start, or starts exactly at end) does not count', () => {
    expect(peakConcurrency([iv('09:00', '10:00'), iv('11:00', '12:00')], at('10:00'), at('11:00'))).toBe(0)
  })

  it('one minute of overlap counts (10:59–12:00 against 10:00–11:00)', () => {
    expect(peakConcurrency([iv('10:59', '12:00')], at('10:00'), at('11:00'))).toBe(1)
  })

  it('two appointments running together count as 2', () => {
    expect(peakConcurrency([iv('10:00', '11:00'), iv('10:30', '11:30')], at('10:00'), at('11:00'))).toBe(2)
  })

  it('back-to-back appointments inside the window never run together → peak 1, not 2', () => {
    expect(peakConcurrency([iv('10:00', '10:30'), iv('10:30', '11:00')], at('10:00'), at('11:00'))).toBe(1)
  })

  it('only the part inside the window matters (clipped): overlap that peaks outside is ignored', () => {
    // 09:00–10:15 and 09:30–10:00 overlap each other only before 10:00.
    expect(peakConcurrency([iv('09:00', '10:15'), iv('09:30', '10:00')], at('10:00'), at('11:00'))).toBe(1)
  })

  it('three staggered appointments peak at the instant all three run', () => {
    const occupants = [iv('10:00', '12:00'), iv('10:30', '11:30'), iv('11:00', '11:15'), iv('11:45', '12:00')]
    expect(peakConcurrency(occupants, at('10:00'), at('12:00'))).toBe(3)
  })
})

describe('capacitySnapshot', () => {
  it('capacity 1, nothing booked → available, 1 remaining', () => {
    expect(capacitySnapshot(1, [], at('10:00'), at('11:00'))).toEqual({ capacity: 1, occupied: 0, remaining: 1, available: true })
  })

  it('capacity 1, one overlapping → full', () => {
    expect(capacitySnapshot(1, [iv('10:30', '11:30')], at('10:00'), at('11:00'))).toEqual({ capacity: 1, occupied: 1, remaining: 0, available: false })
  })

  it('capacity 2 with back-to-back bookings still has room for 10:00–11:00', () => {
    expect(capacitySnapshot(2, [iv('10:00', '10:30'), iv('10:30', '11:00')], at('10:00'), at('11:00')).available).toBe(true)
  })

  it('legacy over-booking (occupied > capacity) reports remaining 0, never negative', () => {
    expect(capacitySnapshot(1, [iv('10:00', '11:00'), iv('10:00', '11:00')], at('10:00'), at('11:00'))).toEqual({
      capacity: 1,
      occupied: 2,
      remaining: 0,
      available: false,
    })
  })
})
