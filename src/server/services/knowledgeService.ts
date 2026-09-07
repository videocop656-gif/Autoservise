import type { KnowledgeCategory } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { knowledgeRepository } from '../repositories/knowledgeRepository'
import type { CreateKnowledgeItemInput, UpdateKnowledgeItemInput } from '../validation/knowledge.schemas'

export function listKnowledgeItems(ctx: AuthContext, options: { activeOnly: boolean; category?: KnowledgeCategory }) {
  return knowledgeRepository.listByBusiness(ctx.tenant.id, ctx.business.id, options)
}

export async function getKnowledgeItem(ctx: AuthContext, id: string) {
  const item = await knowledgeRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!item) {
    // Never distinguish "doesn't exist" from "belongs to another tenant".
    throw new ApiError(404, 'NOT_FOUND', 'Knowledge item not found')
  }
  return item
}

export async function createKnowledgeItem(ctx: AuthContext, input: CreateKnowledgeItemInput) {
  requireRole(ctx, 'owner', 'admin')

  return knowledgeRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    title: input.title,
    content: input.content,
    category: input.category,
  })
}

export async function updateKnowledgeItem(ctx: AuthContext, id: string, input: UpdateKnowledgeItemInput) {
  requireRole(ctx, 'owner', 'admin')

  const updated = await knowledgeRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Knowledge item not found')
  }
  return updated
}

/** Idempotent: deactivating an already-inactive item still succeeds. */
export async function deactivateKnowledgeItem(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, 'owner', 'admin')

  const count = await knowledgeRepository.deactivate(ctx.tenant.id, ctx.business.id, id)
  if (count === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Knowledge item not found')
  }
}
