import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../domain/currency'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

const priceSchema = z.number().finite('Price must be a finite number').nonnegative('Price cannot be negative').max(100_000_000)

const nameSchema = z.string().trim().min(2, 'Name is too short').max(200)
const descriptionSchema = z.preprocess(emptyToNull, z.string().trim().max(2000).nullable())
const durationSchema = z
  .number()
  .int('Duration must be a whole number of minutes')
  .min(5, 'Duration must be at least 5 minutes')
  .max(1440, 'Duration cannot exceed 24 hours')

// Prompt 48 — standard repeat-service interval, whole days. null = "not set"
// (no automatic follow-up). 0, negatives and fractions are rejected; the
// upper bound (10 years) only guards against typos.
const repeatIntervalDaysSchema = z
  .number()
  .int('Интервал должен быть целым числом дней')
  .positive('Интервал должен быть не менее 1 дня')
  .max(3650, 'Интервал не может превышать 3650 дней')
  .nullable()

// MCR-3 — the business's own condition for the price (plain text, never a number source).
export const PRICE_NOTE_MAX = 300
const priceNoteSchema = z.preprocess(emptyToNull, z.string().trim().max(PRICE_NOTE_MAX, `Условия цены — не более ${PRICE_NOTE_MAX} символов`).nullable())

/** Allowed shapes only (see src/server/domain/pricing.ts): FIXED, FROM, RANGE or no price. */
export const PRICE_TO_WITHOUT_FROM = 'Укажите «Цена от»: цена «до» без нижней границы не поддерживается'

function checkPriceRange<T extends { priceFrom?: number | null; priceTo?: number | null }>(
  data: T,
  ctx: z.RefinementCtx
): void {
  if (data.priceTo != null && data.priceFrom === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: PRICE_TO_WITHOUT_FROM, path: ['priceTo'] })
  }
  if (data.priceFrom != null && data.priceTo != null && data.priceTo < data.priceFrom) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'priceTo must be greater than or equal to priceFrom',
      path: ['priceTo'],
    })
  }
}

export const createServiceSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema.optional(),
    priceFrom: priceSchema.nullable().optional(),
    priceTo: priceSchema.nullable().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    durationMinutes: durationSchema,
    repeatIntervalDays: repeatIntervalDaysSchema.optional(),
    priceNote: priceNoteSchema.optional(),
    requiresInspection: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // On create an omitted priceFrom means "no lower bound" too.
    checkPriceRange({ ...data, priceFrom: data.priceFrom ?? null }, ctx)
  })

export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    priceFrom: priceSchema.nullable().optional(),
    priceTo: priceSchema.nullable().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    durationMinutes: durationSchema.optional(),
    repeatIntervalDays: repeatIntervalDaysSchema.optional(),
    priceNote: priceNoteSchema.optional(),
    requiresInspection: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })
  .superRefine(checkPriceRange)

export const serviceIdParamSchema = z.string().uuid()

export type CreateServiceInput = z.infer<typeof createServiceSchema>
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>
