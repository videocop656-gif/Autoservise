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

function checkPriceRange<T extends { priceFrom?: number | null; priceTo?: number | null }>(
  data: T,
  ctx: z.RefinementCtx
): void {
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
  })
  .superRefine(checkPriceRange)

export const updateServiceSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    priceFrom: priceSchema.nullable().optional(),
    priceTo: priceSchema.nullable().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    durationMinutes: durationSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })
  .superRefine(checkPriceRange)

export const serviceIdParamSchema = z.string().uuid()

export type CreateServiceInput = z.infer<typeof createServiceSchema>
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>
