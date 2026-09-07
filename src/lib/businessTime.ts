/**
 * Client-side counterpart to the server's toBusinessLocalDateTime — needed
 * because the Appointments form takes separate Date / Start time / End time
 * inputs (deliberately, so there's no native <input type="datetime-local">
 * silently applying the *browser's* timezone). Both directions go through
 * Intl.DateTimeFormat with an explicit `timeZone`, never the browser's own
 * zone, never manual UTC offset math (which breaks across DST changes).
 */

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

/** Converts a Business-local wall-clock date+time (e.g. from separate <input type="date"> / <input type="time">) to the correct UTC Date, DST-aware. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute] = timeStr.split(':').map(Number)
  const target = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0)

  // Two iterations converge even right around a DST transition.
  let utc = target
  for (let i = 0; i < 2; i++) {
    const offset = getZonedEpoch(new Date(utc), timeZone) - utc
    utc = target - offset
  }
  return new Date(utc)
}

/** Formats a UTC instant as separate Business-local "YYYY-MM-DD" / "HH:mm" strings, for display and for pre-filling the edit form. */
export function utcToZonedParts(date: Date, timeZone: string): { dateStr: string; timeStr: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value
  }
  const hour = parts.hour === '24' ? '00' : parts.hour
  return { dateStr: `${parts.year}-${parts.month}-${parts.day}`, timeStr: `${hour}:${parts.minute}` }
}
