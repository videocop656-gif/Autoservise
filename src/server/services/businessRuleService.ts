import type { BusinessRuleCategory } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { businessRuleRepository } from '../repositories/businessRuleRepository'
import type { CreateBusinessRuleInput, UpdateBusinessRuleInput } from '../validation/businessRule.schemas'

export function listBusinessRules(ctx: AuthContext, options: { activeOnly: boolean; category?: BusinessRuleCategory }) {
  return businessRuleRepository.listByBusiness(ctx.tenant.id, ctx.business.id, options)
}

export async function getBusinessRule(ctx: AuthContext, id: string) {
  const rule = await businessRuleRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!rule) {
    throw new ApiError(404, 'NOT_FOUND', 'Business rule not found')
  }
  return rule
}

export async function createBusinessRule(ctx: AuthContext, input: CreateBusinessRuleInput) {
  requireRole(ctx, 'owner', 'admin')

  return businessRuleRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    name: input.name,
    description: input.description,
    category: input.category,
    priority: input.priority,
  })
}

export async function updateBusinessRule(ctx: AuthContext, id: string, input: UpdateBusinessRuleInput) {
  requireRole(ctx, 'owner', 'admin')

  const updated = await businessRuleRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Business rule not found')
  }
  return updated
}

/** Idempotent: deactivating an already-inactive rule still succeeds. */
export async function deactivateBusinessRule(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, 'owner', 'admin')

  const count = await businessRuleRepository.deactivate(ctx.tenant.id, ctx.business.id, id)
  if (count === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Business rule not found')
  }
}
