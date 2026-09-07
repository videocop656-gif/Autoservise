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
