import type { AppointmentStatus } from '@prisma/client'

/**
 * Prompt 50 — workshop capacity (service bays / posts), v1 semantics.
 *
 * One number per Business: at most `serviceBayCapacity` capacity-consuming
 * appointments may overlap at any single instant. No individual bays, no
 * technicians, no per-service capacity.
 *
 * Pure functions only — the single canonical calculation shared by
 * appointment create/reschedule (inside the locked transaction), the
 * interval check behind GET /api/appointments/availability and the slot
 * generator the AI check_availability tool already calls. Nothing else may
 * compute capacity on its own.
 */

/**
 * Statuses that occupy a post. Deliberately the same set that blocks a
 * vehicle's time slot (appointmentRepository.CONFLICT_BLOCKING_STATUSES):
 * COMPLETED / CANCELLED / NO_SHOW never consume capacity. The lifecycle
 * never moves a terminal appointment back to an active status, so a status
 * change can never start consuming capacity.
 */
export const CAPACITY_CONSUMING_STATUSES: readonly AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']

export function consumesCapacity(status: AppointmentStatus): boolean {
  return CAPACITY_CONSUMING_STATUSES.includes(status)
}

export const CAPACITY_EXCEEDED_CODE = 'CAPACITY_EXCEEDED'
export const CAPACITY_EXCEEDED_MESSAGE = 'На выбранное время нет свободных постов.'

export interface TimeInterval {
  startAt: Date
  endAt: Date
}

/**
 * The largest number of `intervals` in progress at the same instant inside
 * the half-open window [start, end). Half-open everywhere, exactly like the
 * vehicle conflict query (startAt < end AND endAt > start): an appointment
 * ending at 11:00 and one starting at 11:00 never overlap, so at an equal
 * instant an end is processed before a start.
 *
 * This is the occupancy that matters for "can one more vehicle come in?" —
 * not the plain count of overlapping appointments: with capacity 2,
 * 10:00–10:30 and 10:30–11:00 never run together, so 10:00–11:00 still fits.
 */
export function peakConcurrency(intervals: readonly TimeInterval[], start: Date, end: Date): number {
  const s = start.getTime()
  const e = end.getTime()
  const events: [number, number][] = []
  for (const interval of intervals) {
    const from = Math.max(interval.startAt.getTime(), s)
    const to = Math.min(interval.endAt.getTime(), e)
    if (from < to) {
      events.push([from, 1], [to, -1])
    }
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    if (current > peak) peak = current
  }
  return peak
}

export interface CapacitySnapshot {
  /** Business.serviceBayCapacity. */
  capacity: number
  /** Peak number of posts already taken during the interval. */
  occupied: number
  /** capacity − occupied, never below 0 (legacy overbooking stays visible as 0). */
  remaining: number
  /** Whether one more vehicle fits for the whole interval. */
  available: boolean
}

export function capacitySnapshot(capacity: number, occupants: readonly TimeInterval[], start: Date, end: Date): CapacitySnapshot {
  const occupied = peakConcurrency(occupants, start, end)
  const remaining = Math.max(0, capacity - occupied)
  return { capacity, occupied, remaining, available: remaining >= 1 }
}
