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
