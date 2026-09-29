import { utcToZonedParts } from '../../lib/businessTime'
import { addDaysToDateStr } from '../appointments/shared'

// ---------------------------------------------------------------------------
// Prompt 48 — Service Follow-up / Retention Loop: shared frontend helpers.
// Pure, framework-free functions (same convention as appointments/shared.ts)
// so the due-window/ordering rules are unit-testable without component
// tests. "Today" is always the Business's own calendar day — the caller
// passes it in; nothing here reads the browser's timezone or clock.
// ---------------------------------------------------------------------------

export type FollowUpStatus = 'PENDING' | 'CONTACTED' | 'BOOKED' | 'DISMISSED'

export interface ServiceFollowUpDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string | null
  serviceRecordId: string | null
  dueAt: string
  status: FollowUpStatus
  customerRequestId: string | null
  note: string | null
  createdAt: string
  updatedAt: string
}

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  PENDING: 'Ожидает',
  CONTACTED: 'Передан в обращение',
  BOOKED: 'Записан',
  DISMISSED: 'Не требуется',
}

/** How many days ahead of today the Operations queue looks (spec §14: today + 7 days). */
export const FOLLOW_UP_QUEUE_DAYS_AHEAD = 7

/** A follow-up's due day ("YYYY-MM-DD") in the Business timezone. dueAt is stored as that day's local midnight. */
export function followUpDueDateStr(dueAt: string, timeZone: string): string {
  return utcToZonedParts(new Date(dueAt), timeZone).dateStr
}

/**
 * The first Business-local day that is OUTSIDE the Operations window —
 * i.e. the queue shows everything due before this day: overdue, today, and
 * the next FOLLOW_UP_QUEUE_DAYS_AHEAD days inclusive.
 */
export function followUpQueueEndExclusiveDateStr(todayDateStr: string): string {
  return addDaysToDateStr(todayDateStr, FOLLOW_UP_QUEUE_DAYS_AHEAD + 1)
}

export type FollowUpBucket = 'overdue' | 'today' | 'upcoming'

/** Plain string comparison is correct: both are zero-padded "YYYY-MM-DD" calendar days. */
export function followUpBucket(dueDateStr: string, todayDateStr: string): FollowUpBucket {
  if (dueDateStr < todayDateStr) return 'overdue'
  if (dueDateStr === todayDateStr) return 'today'
  return 'upcoming'
}

export const FOLLOW_UP_BUCKET_LABELS: Record<FollowUpBucket, string> = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  upcoming: 'Скоро',
}

const BUCKET_ORDER: Record<FollowUpBucket, number> = { overdue: 0, today: 1, upcoming: 2 }

/**
 * Operations order (spec §14): overdue, then today, then upcoming; dueAt
 * ascending within each group. Returns a new array.
 */
export function sortFollowUpsForQueue<T extends { dueAt: string }>(items: T[], todayDateStr: string, timeZone: string): T[] {
  return [...items].sort((a, b) => {
    const bucketDiff =
      BUCKET_ORDER[followUpBucket(followUpDueDateStr(a.dueAt, timeZone), todayDateStr)] -
      BUCKET_ORDER[followUpBucket(followUpDueDateStr(b.dueAt, timeZone), todayDateStr)]
    if (bucketDiff !== 0) return bucketDiff
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  })
}

/**
 * The "Следующий контакт" suggestion on the ServiceRecord form (Case B):
 * the performed day + the service's repeat interval, in whole Business-
 * local days. Empty when there is no date yet or no interval — which the
 * form then sends as "no follow-up" (Case C).
 */
export function suggestedFollowUpDateStr(performedDateStr: string, repeatIntervalDays: number | null | undefined): string {
  if (!performedDateStr || repeatIntervalDays == null || repeatIntervalDays <= 0) return ''
  return addDaysToDateStr(performedDateStr, repeatIntervalDays)
}

/** "12.03.2027" — the due day as the Business sees it (never the browser's timezone). */
export function formatFollowUpDueDate(dueAt: string, timeZone: string): string {
  const [y, m, d] = followUpDueDateStr(dueAt, timeZone).split('-')
  return `${d}.${m}.${y}`
}
