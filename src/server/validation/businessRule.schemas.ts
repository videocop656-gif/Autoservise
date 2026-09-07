import { z } from 'zod'
import { BusinessRuleCategory } from '@prisma/client'

// Lower number = higher priority. 0 = highest, 100 = lowest, 50 = default.
const prioritySchema = z.number().int('Priority must be a whole number').min(0).max(100)

// isActive is intentionally absent from create: new rules are always
// active; it can only be toggled via update/deactivate.
export const createBusinessRuleSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(200),
  description: z.string().trim().min(2, 'Description is too short').max(10000),
  category: z.nativeEnum(BusinessRuleCategory).default('GENERAL'),
  priority: prioritySchema.default(50),
})

export const updateBusinessRuleSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(200).optional(),
    description: z.string().trim().min(2, 'Description is too short').max(10000).optional(),
    category: z.nativeEnum(BusinessRuleCategory).optional(),
    priority: prioritySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const businessRuleCategoryFilterSchema = z.nativeEnum(BusinessRuleCategory)
export const businessRuleIdParamSchema = z.string().uuid()

export type CreateBusinessRuleInput = z.infer<typeof createBusinessRuleSchema>
export type UpdateBusinessRuleInput = z.infer<typeof updateBusinessRuleSchema>
