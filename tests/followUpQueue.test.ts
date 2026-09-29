import { describe, expect, it } from 'vitest'
import { zonedTimeToUtc } from '../src/lib/businessTime'
import {
  followUpBucket,
  followUpDueDateStr,
  followUpQueueEndExclusiveDateStr,
  formatFollowUpDueDate,
  sortFollowUpsForQueue,
  suggestedFollowUpDateStr,
} from '../src/components/followUps/shared'
import { followUpDueAtFromDateKey } from '../src/server/services/serviceFollowUpService'

// ---------------------------------------------------------------------------
// Prompt 48 — the Operations "Повторный контакт" due window and ordering,
// plus the ServiceRecord form's suggested date. Pure helpers, no clock: the
// Business's "today" is passed in, exactly as the UI derives it from
// Business.timezone (never the browser's).
// ---------------------------------------------------------------------------

const MOSCOW = 'Europe/Moscow'
const BERLIN = 'Europe/Berlin'

/** The dueAt the server stores for a Business-local due day. */
function dueAt(dateKey: string, tz = MOSCOW): string {
  return followUpDueAtFromDateKey(dateKey, tz).toISOString()
}

/** Exactly what FollowUpQueueSection sends as ?dueBefore= (the server applies dueAt < dueBefore). */
function queueDueBefore(todayDateStr: string, tz = MOSCOW): Date {
  return zonedTimeToUtc(followUpQueueEndExclusiveDateStr(todayDateStr), '00:00', tz)
}

function inQueue(dueDateKey: string, todayDateStr: string, tz = MOSCOW): boolean {
  return new Date(dueAt(dueDateKey, tz)).getTime() < queueDueBefore(todayDateStr, tz).getTime()
}

describe('Operations due window: overdue … today … today + 7 days', () => {
  it('the window ends after today + 7 days (exclusive bound = today + 8)', () => {
    expect(followUpQueueEndExclusiveDateStr('2026-09-29')).toBe('2026-10-07')
    expect(followUpQueueEndExclusiveDateStr('2026-12-28')).toBe('2027-01-05')
  })

  it('includes overdue, today and today + 7; excludes today + 8', () => {
    const today = '2026-09-29'
    expect(inQueue('2026-08-01', today)).toBe(true)
    expect(inQueue('2026-09-28', today)).toBe(true)
    expect(inQueue('2026-09-29', today)).toBe(true)
    expect(inQueue('2026-10-06', today)).toBe(true)
    expect(inQueue('2026-10-07', today)).toBe(false)
  })

  it('the server-side bound is the Business-local midnight, not the browser/UTC day', () => {
    // Moscow midnight of 2026-10-07 is 2026-10-06T21:00Z.
    expect(queueDueBefore('2026-09-29').toISOString()).toBe('2026-10-06T21:00:00.000Z')
  })

  it('stays exact across a DST switch inside the window (Europe/Berlin, autumn)', () => {
    const today = '2026-10-20' // window runs over the 2026-10-25 CEST→CET switch
    expect(inQueue('2026-10-27', today, BERLIN)).toBe(true)
    expect(inQueue('2026-10-28', today, BERLIN)).toBe(false)
    expect(queueDueBefore(today, BERLIN).toISOString()).toBe('2026-10-27T23:00:00.000Z')
  })
})

describe('buckets and ordering: overdue → today → upcoming, dueAt ASC within', () => {
  it('classifies by Business-local calendar day', () => {
    expect(followUpBucket('2026-09-28', '2026-09-29')).toBe('overdue')
    expect(followUpBucket('2026-09-29', '2026-09-29')).toBe('today')
    expect(followUpBucket('2026-09-30', '2026-09-29')).toBe('upcoming')
  })

  it('a dueAt at Business-local midnight maps back to that same local day', () => {
    expect(followUpDueDateStr(dueAt('2026-10-01'), MOSCOW)).toBe('2026-10-01')
    expect(followUpDueDateStr(dueAt('2026-03-29', BERLIN), BERLIN)).toBe('2026-03-29')
    expect(formatFollowUpDueDate(dueAt('2027-03-28'), MOSCOW)).toBe('28.03.2027')
  })

  it('the same instant can be "today" for the Business while it is still yesterday in UTC', () => {
    // Moscow midnight 2026-09-29 = 2026-09-28T21:00Z: UTC says the 28th, the Business says the 29th.
    const iso = dueAt('2026-09-29')
    expect(iso).toBe('2026-09-28T21:00:00.000Z')
    expect(followUpBucket(followUpDueDateStr(iso, MOSCOW), '2026-09-29')).toBe('today')
  })

  it('sorts overdue first, then today, then upcoming, each by dueAt ascending', () => {
    const items = [
      { id: 'up-2', dueAt: dueAt('2026-10-05') },
      { id: 'today', dueAt: dueAt('2026-09-29') },
      { id: 'overdue-late', dueAt: dueAt('2026-09-27') },
      { id: 'up-1', dueAt: dueAt('2026-09-30') },
      { id: 'overdue-early', dueAt: dueAt('2026-09-01') },
    ]

    expect(sortFollowUpsForQueue(items, '2026-09-29', MOSCOW).map((i) => i.id)).toEqual([
      'overdue-early',
      'overdue-late',
      'today',
      'up-1',
      'up-2',
    ])
  })
})

describe('ServiceRecord form — suggested "Следующий контакт"', () => {
  it('is the performed day + the service repeat interval', () => {
    expect(suggestedFollowUpDateStr('2026-09-29', 180)).toBe('2027-03-28')
  })

  it('is empty (= no follow-up) without an interval or without a date', () => {
    expect(suggestedFollowUpDateStr('2026-09-29', null)).toBe('')
    expect(suggestedFollowUpDateStr('2026-09-29', undefined)).toBe('')
    expect(suggestedFollowUpDateStr('', 180)).toBe('')
  })
})
