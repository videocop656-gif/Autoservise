// ---------------------------------------------------------------------------
// Prompt 28 — Appointment Detail v1. Shared types/helpers between the
// appointments list (AppointmentsSettingsPage.tsx) and
// AppointmentDetailPanel.tsx. Customer/Vehicle/Service reference shapes,
// CustomerRequestRefDto, and formatActivity are the exact same backend
// truth already declared in components/conversations/shared.ts;
// AppointmentStatus/APPOINTMENT_STATUS_LABELS are the exact same ones
// already declared in components/requests/shared.ts (added there in
// Prompt 27 for Request Detail's "Запись" section) — reused from both
// instead of redeclared, so labels/formatting never drift between screens.
// ---------------------------------------------------------------------------

export type {
  CustomerRefDto,
  VehicleRefDto,
  ServiceRefDto,
  CustomerRequestRefDto,
  Paginated,
} from '../conversations/shared'
export { customerName, serviceName, formatActivity } from '../conversations/shared'
export type { AppointmentStatus } from '../requests/shared'
export { APPOINTMENT_STATUS_LABELS, REQUEST_STATUS_LABELS } from '../requests/shared'
export type { ServiceRecordDto } from '../clients/shared'
// vehicleLabel takes a single vehicle object here (Appointment/Client
// Detail both already resolve one specific VehicleRefDto before calling
// it) — the same single-object helper Client/Vehicle Detail already use,
// not the (vehicles[], id) lookup form conversations/shared exports for
// list-row rendering.
export { formatDate, vehicleLabel } from '../clients/shared'

import type { AppointmentStatus } from '../requests/shared'

export interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
  endAt: string
  status: AppointmentStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

// Frontend mirror of appointmentService.ts's own ALLOWED_TRANSITIONS table
// (audited directly from that file, not guessed) — same convention as
// Prompt 27's request NEXT_STATUSES. The backend remains the sole
// enforcer; this only avoids offering a transition it would reject.
// COMPLETED/CANCELLED/NO_SHOW are real terminal states.
export const APPOINTMENT_NEXT_STATUSES: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function isAppointmentTerminal(status: AppointmentStatus): boolean {
  return APPOINTMENT_NEXT_STATUSES[status].length === 0
}

// ---------------------------------------------------------------------------
// Prompt 36 — Operations Daily Work Queue.
//
// Which of the six real AppointmentStatus values still represent
// actionable, not-yet-resolved work today — audited from
// appointmentService.ts's own ALLOWED_TRANSITIONS (the three non-terminal
// statuses; COMPLETED/CANCELLED/NO_SHOW are the real terminal ones,
// already established by APPOINTMENT_NEXT_STATUSES above). Shared here
// (not declared locally in OperationsPage.tsx) so a future screen that
// also needs "is this appointment still active today" reads the exact
// same rule, never a second copy of it.
// ---------------------------------------------------------------------------
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']

/**
 * Splits a list of appointments (already server-filtered to one day, or
 * any other bounded set) into the ones that belong in an active work
 * queue and a count of the rest — never a second full list, per Operations
 * spec §5 ("a small summary, shown separately, never mixed into the
 * active queue"). Pure and framework-free: no fetching, no sorting
 * opinion — the caller still owns ordering.
 */
export function splitAppointmentsByActivity<T extends { status: AppointmentStatus }>(appointments: T[]): { active: T[]; otherCount: number } {
  const active = appointments.filter((a) => ACTIVE_APPOINTMENT_STATUSES.includes(a.status))
  return { active, otherCount: appointments.length - active.length }
}

// ---------------------------------------------------------------------------
// Prompt 33 — Service Completion Visibility.
//
// A COMPLETED appointment is never guaranteed to have a linked ServiceRecord
// — completing an appointment is purely a status change (audited directly:
// appointmentService.ts never touches serviceRecordRepository, see the
// Prompt 32 audit). This is a pure, framework-free classifier over data
// AppointmentDetailPanel already fetches for its own "История обслуживания"
// section (GET /api/service-history?vehicleId=, filtered client-side to
// this appointment's own real appointmentId) — no new query, no new
// endpoint, just naming the four states that filtered result can be in:
//
//   'not-applicable' — status isn't COMPLETED; the missing-result question
//                       doesn't apply (spec §4 — the warning is ONLY ever
//                       about COMPLETED + missing ServiceRecord).
//   'unknown'         — the history lookup itself failed; we genuinely
//                       don't know, so neither the warning nor the
//                       "recorded" state may be shown (never guess).
//   'missing'         — COMPLETED, lookup succeeded, zero matching records.
//   'recorded'        — COMPLETED, lookup succeeded, at least one match.
// ---------------------------------------------------------------------------
export type ServiceCompletionState = 'not-applicable' | 'unknown' | 'missing' | 'recorded'

export function serviceCompletionState(status: AppointmentStatus, historyCount: number, historyError: boolean): ServiceCompletionState {
  if (status !== 'COMPLETED') return 'not-applicable'
  if (historyError) return 'unknown'
  return historyCount === 0 ? 'missing' : 'recorded'
}

// ---------------------------------------------------------------------------
// Prompt 35 — Appointment List & Date Navigation UX.
//
// Pure, framework-free date-range math over Business-local "YYYY-MM-DD"
// calendar-date strings (the exact string shape utcToZonedParts() already
// produces) — never the browser's own timezone, never a new date library.
// The API's own GET /api/appointments?dateFrom=&dateTo= (already built,
// see appointmentRepository.list's `startAt: { gte: dateFrom, lt: dateTo }`)
// takes UTC instants; converting a calendar-date boundary to one is the
// caller's job via the existing zonedTimeToUtc(dateStr, '00:00', timezone)
// — these helpers only ever produce/consume the calendar-date strings, kept
// separate from that UTC conversion so they stay trivially unit-testable
// with no Date/timezone mocking required.
// ---------------------------------------------------------------------------
export type AppointmentDateRangePreset = 'all' | 'today' | 'tomorrow' | 'week' | 'nextWeek' | 'custom'

export const APPOINTMENT_DATE_RANGE_LABELS: Record<AppointmentDateRangePreset, string> = {
  all: 'Все',
  today: 'Сегодня',
  tomorrow: 'Завтра',
  week: 'Эта неделя',
  nextWeek: 'Следующая неделя',
  custom: 'Период',
}

/** Adds (or subtracts, for a negative count) whole calendar days to a "YYYY-MM-DD" string — plain UTC-anchored arithmetic, so it is immune to DST (the string never carries a time-of-day to be shifted). */
export function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a "YYYY-MM-DD" calendar date — used to find the Monday that starts its week (this app's week starts Monday, matching BusinessWorkingHours' own Monday-first DayOfWeek convention). */
function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

/**
 * The [from, to) calendar-date bounds for a quick preset, anchored on
 * `todayDateStr` (the Business's own local "today" — the caller must pass
 * utcToZonedParts(new Date(), timezone).dateStr, never a browser-local
 * date). `to` is always EXCLUSIVE, matching the existing API's own
 * `dateTo` semantics (`startAt: { lt: dateTo }`).
 *
 * Returns null for 'all' (no date filter — the pre-Prompt-35 default
 * behavior, unchanged) and for 'custom' (the caller supplies its own
 * from/to from the two date inputs; there's nothing to derive here).
 */
export function appointmentDateRangeBounds(
  preset: AppointmentDateRangePreset,
  todayDateStr: string
): { from: string; to: string } | null {
  switch (preset) {
    case 'all':
    case 'custom':
      return null
    case 'today':
      return { from: todayDateStr, to: addDaysToDateStr(todayDateStr, 1) }
    case 'tomorrow': {
      const from = addDaysToDateStr(todayDateStr, 1)
      return { from, to: addDaysToDateStr(from, 1) }
    }
    case 'week': {
      const from = addDaysToDateStr(todayDateStr, -(isoWeekday(todayDateStr) - 1))
      return { from, to: addDaysToDateStr(from, 7) }
    }
    case 'nextWeek': {
      const thisWeekFrom = addDaysToDateStr(todayDateStr, -(isoWeekday(todayDateStr) - 1))
      const from = addDaysToDateStr(thisWeekFrom, 7)
      return { from, to: addDaysToDateStr(from, 7) }
    }
  }
}

function formatRuMonthDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)))
}

/** A short, human label for the currently selected period — "Сегодня, 15 сентября" / "14 сентября — 20 сентября" / "Все" — never a bare ISO range, matching this app's existing Russian-date-formatting convention (formatDate/formatActivity). */
export function appointmentDateRangeLabel(preset: AppointmentDateRangePreset, bounds: { from: string; to: string } | null): string {
  if (preset === 'all' || !bounds) return APPOINTMENT_DATE_RANGE_LABELS.all
  const inclusiveEnd = addDaysToDateStr(bounds.to, -1)
  if (preset === 'today') return `Сегодня, ${formatRuMonthDay(bounds.from)}`
  if (preset === 'tomorrow') return `Завтра, ${formatRuMonthDay(bounds.from)}`
  if (bounds.from === inclusiveEnd) return formatRuMonthDay(bounds.from)
  return `${formatRuMonthDay(bounds.from)} — ${formatRuMonthDay(inclusiveEnd)}`
}
