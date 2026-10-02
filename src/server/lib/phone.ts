import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from 'libphonenumber-js/max'

// ---------------------------------------------------------------------------
// MCR-1 — Phone Identity Foundation: the ONE server-side phone normalization.
//
// A missed call starts from a phone number, so customer identity needs one
// canonical form: E.164 ("+77011234567"). Customer.phone keeps exactly what
// the operator typed (display); Customer.phoneE164 holds the canonical form
// (indexed, deliberately NOT unique — families share numbers, legacy
// duplicates exist, and the same person can be a customer of several
// businesses).
//
// Parsing/validation is libphonenumber-js ("max" metadata = full per-country
// validation, Google libphonenumber data; MIT, no dependencies, server-only
// import). National input ("8 701 …", "701 …") is read in the business's
// default region (Business.phoneRegion, ISO 3166-1 alpha-2, e.g. "KZ");
// international input ("+…") is always read as written and never
// reinterpreted as the default region. Only numbers the library considers
// VALID become an identity — nothing is guessed or padded.
// ---------------------------------------------------------------------------

export type PhoneNormalization =
  | { status: 'valid'; e164: string; country: string | null }
  | { status: 'empty' }
  | { status: 'invalid' }

/** A region code is usable only if libphonenumber knows it ("KZ", "RU", …). */
export function isSupportedPhoneRegion(region: string | null | undefined): region is CountryCode {
  return typeof region === 'string' && /^[A-Z]{2}$/.test(region) && isSupportedCountry(region)
}

/**
 * Parses a human-entered phone. `defaultRegion` is used only for numbers
 * written without "+"; without a (supported) default region such numbers are
 * `invalid` — never assumed to be from any particular country.
 */
export function parsePhone(input: string | null | undefined, defaultRegion?: string | null): PhoneNormalization {
  if (typeof input !== 'string' || input.trim() === '') return { status: 'empty' }
  const region = isSupportedPhoneRegion(defaultRegion) ? defaultRegion : undefined
  const parsed = parsePhoneNumberFromString(input.trim(), region)
  if (!parsed || !parsed.isValid()) return { status: 'invalid' }
  return { status: 'valid', e164: parsed.number, country: parsed.country ?? null }
}

/** Canonical E.164 string, or null for empty / invalid input. */
export function normalizePhone(input: string | null | undefined, defaultRegion?: string | null): string | null {
  const result = parsePhone(input, defaultRegion)
  return result.status === 'valid' ? result.e164 : null
}

/**
 * For logs and debug output — never the full number. A valid number keeps
 * its country calling code and the last 4 digits ("+77011234567" →
 * "+7******4567"); anything else is fully masked.
 */
export function maskPhone(input: string | null | undefined, defaultRegion?: string | null): string {
  const e164 = normalizePhone(input, defaultRegion)
  if (!e164) return '***'
  const parsed = parsePhoneNumberFromString(e164)
  const code = parsed ? `+${parsed.countryCallingCode}` : '+'
  const hidden = Math.max(e164.length - code.length - 4, 1)
  return `${code}${'*'.repeat(hidden)}${e164.slice(-4)}`
}
