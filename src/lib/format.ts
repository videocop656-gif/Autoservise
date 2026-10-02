// ---------------------------------------------------------------------------
// Prompt 48.2 — shared, display-only formatters for the Russian UI.
//
// Nothing here changes stored or transported values: the API keeps sending
// money as fixed-point strings ("4800.00") with an ISO currency code, and
// numeric form inputs keep their raw values. These helpers only turn such
// values into what a person reads on screen ("4 800 ₽").
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽',
  KZT: '₸',
  USD: '$',
  EUR: '€',
}

// ru-RU grouping ("3 000"); kopecks only when there are any, and then always
// two digits ("4 800", but "4 800,50" — never "4 800,5").
const WHOLE_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const FRACTION_FORMAT = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

function formatAmount(value: string | number): string {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return Number.isInteger(amount) ? WHOLE_FORMAT.format(amount) : FRACTION_FORMAT.format(amount)
}

/** "4800.00", "RUB" → "4 800 ₽" (a no-break space is used for grouping and before the symbol). */
export function formatMoney(value: string | number, currency: string): string {
  return `${formatAmount(value)}\u00A0${currencySymbol(currency)}`
}

/**
 * Russian plural form for a whole number: pluralRu(n, ['день', 'дня', 'дней']).
 * 1, 21, 101 → first; 2–4, 22–24 → second; 0, 5–20, 25–30, 111–114 → third.
 */
export function pluralRu(n: number, forms: [one: string, few: string, many: string]): string {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

/** 1 → "1 день", 2 → "2 дня", 180 → "180 дней". */
export function formatDays(n: number): string {
  return `${n}\u00A0${pluralRu(n, ['день', 'дня', 'дней'])}`
}
