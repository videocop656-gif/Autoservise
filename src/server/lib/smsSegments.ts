// ---------------------------------------------------------------------------
// MCR-6 — provider-neutral SMS length awareness (not billing). Reports the
// encoding a standard SMS would need and how many segments it would take,
// so a recovery SMS can never silently grow to 3–4 paid parts, and so a
// future real provider integration is observable.
//
//   GSM-7 (3GPP TS 23.038 basic set + extension table, extension chars count
//   twice): 160 per single SMS, 153 per part when concatenated.
//   UCS-2 (anything else — Cyrillic included): 70 per single SMS, 67 per
//   part, counted in UTF-16 code units (an emoji costs 2).
// ---------------------------------------------------------------------------

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXTENSION = '^{}\\[~]|€\f'

const BASIC = new Set(GSM7_BASIC)
const EXTENSION = new Set(GSM7_EXTENSION)

export type SmsEncoding = 'GSM7' | 'UCS2'

export interface SmsSegmentInfo {
  encoding: SmsEncoding
  /** Billable units: GSM-7 septets (extension chars = 2) or UCS-2 code units. */
  units: number
  segments: number
  /** Units left in the last segment before another part is needed. */
  remainingInSegment: number
}

export function estimateSmsSegments(text: string): SmsSegmentInfo {
  let septets = 0
  let gsm = true
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1
    else if (EXTENSION.has(ch)) septets += 2
    else {
      gsm = false
      break
    }
  }
  const encoding: SmsEncoding = gsm ? 'GSM7' : 'UCS2'
  const units = gsm ? septets : text.length // String.length = UTF-16 code units
  const single = gsm ? 160 : 70
  const part = gsm ? 153 : 67
  if (units === 0) return { encoding, units, segments: 0, remainingInSegment: single }
  if (units <= single) return { encoding, units, segments: 1, remainingInSegment: single - units }
  const segments = Math.ceil(units / part)
  return { encoding, units, segments, remainingInSegment: segments * part - units }
}
