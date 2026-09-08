/**
 * Validates that `tz` is a real IANA timezone identifier (e.g. "Europe/Moscow"),
 * rejecting free-form strings like "GMT+5" or "Moscow time".
 *
 * Uses Intl.DateTimeFormat, which throws a RangeError for an unrecognized
 * `timeZone` option. This relies on the ICU timezone database bundled with
 * the Node.js runtime; Node 20+ ships full ICU data by default, so this is
 * reliable in both local dev and on Vercel's Node runtime without any extra
 * package or timezone list to maintain.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const WEEKDAY_TO_DAY_OF_WEEK: Record<string, 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'> = {
  Monday: 'MONDAY',
  Tuesday: 'TUESDAY',
  Wednesday: 'WEDNESDAY',
  Thursday: 'THURSDAY',
  Friday: 'FRIDAY',
  Saturday: 'SATURDAY',
  Sunday: 'SUNDAY',
}

export interface BusinessLocalDateTime {
  /** "YYYY-MM-DD" — used to detect whether an interval crosses local midnight. */
  dateKey: string
  /** "HH:mm", zero-padded — directly comparable against BusinessWorkingHours.openTime/closeTime. */
  timeKey: string
  dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
}

/**
 * Converts a UTC instant to the Business's local wall-clock date/time,
 * DST-aware. Deliberately implemented with Intl.DateTimeFormat (the same
 * built-in, ICU-backed mechanism `isValidTimeZone` above already relies on)
 * rather than manual hour arithmetic or a new date library — Node's bundled
 * ICU data handles daylight-saving transitions correctly for any real IANA
 * zone, which fixed-offset math cannot.
 */
export function toBusinessLocalDateTime(date: Date, timeZone: string): BusinessLocalDateTime {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value
  }

  // Some ICU implementations render midnight as "24:00" with hour12:false;
  // normalize it back to "00".
  const hour = parts.hour === '24' ? '00' : parts.hour!

  const dayOfWeek = WEEKDAY_TO_DAY_OF_WEEK[parts.weekday!]
  if (!dayOfWeek) {
    throw new Error(`Unexpected weekday from Intl.DateTimeFormat: ${parts.weekday}`)
  }

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeKey: `${hour}:${parts.minute}`,
    dayOfWeek,
  }
}

function getZonedEpoch(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value
  }
  const hour = parts.hour === '24' ? '00' : parts.hour
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second)
  )
}

/**
 * The inverse of toBusinessLocalDateTime: converts a Business-local
 * "YYYY-MM-DD" date + "HH:mm" time to the correct UTC instant, DST-aware.
 * Needed for Prompt 10's availability slot generation (a local
 * date+time — e.g. a candidate 09:00 slot — has to become a real UTC
 * Date before it can be compared against stored Appointment rows or
 * passed into the existing Appointment Service).
 *
 * This is the server-side twin of src/lib/businessTime.ts's
 * zonedTimeToUtc — same iterative-offset algorithm (two passes converge
 * even right at a DST transition), deliberately not manual UTC-offset
 * arithmetic. It didn't exist before Prompt 10 because nothing on the
 * server previously needed to go local-time -> UTC; every prior stage
 * only ever needed the other direction (toBusinessLocalDateTime above).
 */
export function businessLocalToUtc(dateKey: string, timeKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = timeKey.split(':').map(Number)
  const target = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0)

  let utc = target
  for (let i = 0; i < 2; i++) {
    const offset = getZonedEpoch(new Date(utc), timeZone) - utc
    utc = target - offset
  }
  return new Date(utc)
}
