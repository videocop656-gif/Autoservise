import { z } from 'zod'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

export const createCustomerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
  phone: z.string().trim().min(5, 'Phone is too short').max(50),
  email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email('Invalid email').max(254).nullable().optional()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
})

export const updateCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(100).optional(),
    lastName: z.preprocess(emptyToNull, z.string().trim().max(100).nullable().optional()),
    phone: z.string().trim().min(5, 'Phone is too short').max(50).optional(),
    email: z.preprocess(emptyToNull, z.string().trim().toLowerCase().email('Invalid email').max(254).nullable().optional()),
    notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const customerIdParamSchema = z.string().uuid()

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>
