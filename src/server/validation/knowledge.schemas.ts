import { z } from 'zod'
import { KnowledgeCategory } from '@prisma/client'

// isActive is intentionally absent from create: new items are always
// active (see spec §6); it can only be toggled via update/deactivate.
export const createKnowledgeItemSchema = z.object({
  title: z.string().trim().min(2, 'Title is too short').max(200),
  content: z.string().trim().min(2, 'Content is too short').max(10000),
  category: z.nativeEnum(KnowledgeCategory).default('GENERAL'),
})

export const updateKnowledgeItemSchema = z
  .object({
    title: z.string().trim().min(2, 'Title is too short').max(200).optional(),
    content: z.string().trim().min(2, 'Content is too short').max(10000).optional(),
    category: z.nativeEnum(KnowledgeCategory).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const knowledgeCategoryFilterSchema = z.nativeEnum(KnowledgeCategory)
export const knowledgeIdParamSchema = z.string().uuid()

export type CreateKnowledgeItemInput = z.infer<typeof createKnowledgeItemSchema>
export type UpdateKnowledgeItemInput = z.infer<typeof updateKnowledgeItemSchema>
