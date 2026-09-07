import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../domain/currency'
import { isValidTimeZone } from '../lib/timezone'

/** Lets a cleared form field ("") mean "set to null" instead of failing email/url validation on an empty string. */
const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

export const businessProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(200).optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()).optional(),
    phone: z.preprocess(emptyToNull, z.string().trim().max(50).nullable()).optional(),
    email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email('Invalid email').max(255).nullable()).optional(),
    address: z.preprocess(emptyToNull, z.string().trim().max(500).nullable()).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, { message: 'Invalid IANA timezone (e.g. "Europe/Moscow")' })
      .optional(),
    website: z.preprocess(emptyToNull, z.string().trim().url('Invalid URL').max(300).nullable()).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>
