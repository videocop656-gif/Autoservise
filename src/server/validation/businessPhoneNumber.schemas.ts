import { z } from 'zod'

// MCR-2 — the business's own public phone numbers (telephony routing identity).
export const addBusinessPhoneNumberSchema = z
  .object({
    phone: z.string().trim().min(5, 'Укажите номер телефона.').max(50),
    label: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(100).nullable()).optional(),
  })
  .strict()

export const setBusinessPhoneNumberActiveSchema = z.object({ isActive: z.boolean() }).strict()

export const businessPhoneNumberIdParamSchema = z.string().uuid()

export type AddBusinessPhoneNumberInput = z.infer<typeof addBusinessPhoneNumberSchema>
