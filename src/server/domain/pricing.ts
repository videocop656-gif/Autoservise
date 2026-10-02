// ---------------------------------------------------------------------------
// MCR-3 — the ONE interpretation of a Service's structured price.
//
// Service stores two nullable Decimal bounds (priceFrom, priceTo) + currency.
// Their meaning is decided here and nowhere else — not by UI components, not
// by the AI prompt, not by a provider:
//
//   priceFrom = X, priceTo = X        → FIXED  "15 000 ₸"
//   priceFrom = X, priceTo = null     → FROM   "от 40 000 ₸"
//   priceFrom = X, priceTo = Y (Y > X) → RANGE "10 000–20 000 ₸"
//   neither                           → UNAVAILABLE (no number is claimed)
//   malformed: priceTo without priceFrom, priceTo < priceFrom,
//              negative / non-finite  → UNAVAILABLE (never a customer claim)
//
// Validation (service.schemas.ts + serviceCatalogService) no longer accepts
// the malformed shapes; this function still refuses to turn any legacy or
// hand-edited row into a claim. Inspection and price conditions are
// separate, explicitly configured facts (Service.requiresInspection /
// priceNote) — never inferred from the price type.
// ---------------------------------------------------------------------------

export type PricingType = 'FIXED' | 'FROM' | 'RANGE' | 'UNAVAILABLE'

export interface ServicePricing {
  type: PricingType
  /** Lower bound / fixed amount as a fixed-point string ("40000.00"); null when UNAVAILABLE. */
  min: string | null
  /** Upper bound for RANGE / same as min for FIXED; null for FROM and UNAVAILABLE. */
  max: string | null
  currency: string
  /** Customer-facing text ("от 40 000 ₸"); null when UNAVAILABLE — never an invented number. */
  formatted: string | null
}

type Amount = { toString(): string } | number | string | null | undefined

function toNumber(value: Amount): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value.toString())
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** "₸", "₽", "$", "€"… — the currency's own narrow symbol, or the ISO code if Intl doesn't know one. */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')
    return part?.value ?? currency
  } catch {
    return currency
  }
}

/** "40 000", "1 500,50" — Russian grouping, kopecks/tiyn only when non-zero. */
export function formatAmount(amount: number): string {
  const fraction = Math.round(amount * 100) % 100 !== 0
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: fraction ? 2 : 0, maximumFractionDigits: 2 }).format(amount)
}

export function describeServicePricing(service: { priceFrom: Amount; priceTo: Amount; currency: string }): ServicePricing {
  const from = toNumber(service.priceFrom)
  const to = toNumber(service.priceTo)
  const currency = service.currency
  const unavailable: ServicePricing = { type: 'UNAVAILABLE', min: null, max: null, currency, formatted: null }
  const symbol = currencySymbol(currency)

  if (from === null) return unavailable // no price, or a malformed "to without from"
  if (to === null) {
    return { type: 'FROM', min: from.toFixed(2), max: null, currency, formatted: `от ${formatAmount(from)} ${symbol}` }
  }
  if (to < from) return unavailable // malformed — never claimed
  if (to === from) {
    return { type: 'FIXED', min: from.toFixed(2), max: to.toFixed(2), currency, formatted: `${formatAmount(from)} ${symbol}` }
  }
  return { type: 'RANGE', min: from.toFixed(2), max: to.toFixed(2), currency, formatted: `${formatAmount(from)}–${formatAmount(to)} ${symbol}` }
}
