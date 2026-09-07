/**
 * Foundation-stage currency whitelist (ISO 4217 codes, not symbols). Extend
 * this list when the business needs more currencies — nothing else needs to
 * change since Zod schemas and defaults all read from here.
 */
export const SUPPORTED_CURRENCIES = ['RUB', 'KZT', 'USD', 'EUR'] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_CURRENCY: SupportedCurrency = 'RUB'
