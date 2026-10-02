import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../domain/currency'
import { isValidTimeZone } from '../lib/timezone'
import { isSupportedPhoneRegion } from '../lib/phone'

/** Lets a cleared form field ("") mean "set to null" instead of failing email/url validation on an empty string. */
const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

export const LOCATION_URL_MESSAGE = 'Укажите ссылку на карту, начинающуюся с https:// или http://'

/** An absolute http(s) URL with a host and no whitespace, ≤ 2000 chars. */
export function isSafeLocationUrl(value: string): boolean {
  if (value.length > 2000 || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.length > 0
  } catch {
    return false
  }
}

const locationUrlSchema = z.string().trim().max(2000, LOCATION_URL_MESSAGE).refine(isSafeLocationUrl, { message: LOCATION_URL_MESSAGE })

const SERVICE_BAY_CAPACITY_MESSAGE = 'Количество постов должно быть не менее 1.'
export const MAX_SERVICE_BAY_CAPACITY = 1000

export const businessProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(200).optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()).optional(),
    phone: z.preprocess(emptyToNull, z.string().trim().max(50).nullable()).optional(),
    email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email('Invalid email').max(255).nullable()).optional(),
    address: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()).optional(),
    // MCR-3 — the business's own map/location link. http(s) only (no
    // javascript:/data:/…); never fetched, previewed or rendered as HTML.
    locationUrl: z.preprocess(emptyToNull, locationUrlSchema.nullable()).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, { message: 'Invalid IANA timezone (e.g. "Europe/Moscow")' })
      .optional(),
    website: z.preprocess(emptyToNull, z.string().trim().url('Invalid URL').max(300).nullable()).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    // Prompt 50 — simultaneous service bays / posts. A whole number, at
    // least 1 (also a CHECK in the database). The upper bound is only a
    // sanity limit against typos, not a product rule.
    serviceBayCapacity: z
      .number({ invalid_type_error: SERVICE_BAY_CAPACITY_MESSAGE, required_error: SERVICE_BAY_CAPACITY_MESSAGE })
      .int('Количество постов должно быть целым числом.')
      .min(1, SERVICE_BAY_CAPACITY_MESSAGE)
      .max(MAX_SERVICE_BAY_CAPACITY, `Количество постов не может быть больше ${MAX_SERVICE_BAY_CAPACITY}.`)
      .optional(),
    // MCR-1 — default region for phone numbers written without "+"
    // (ISO 3166-1 alpha-2, one libphonenumber supports).
    phoneRegion: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isSupportedPhoneRegion, { message: 'Неизвестный код страны (например, KZ или RU).' })
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>
