import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { serviceRepository } from '../repositories/serviceRepository'
import type { CreateServiceInput, UpdateServiceInput } from '../validation/service.schemas'

export function listServices(ctx: AuthContext, activeOnly: boolean) {
  return serviceRepository.listByBusiness(ctx.tenant.id, ctx.business.id, activeOnly)
}

export async function getService(ctx: AuthContext, id: string) {
  const service = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!service) {
    // Never distinguish "doesn't exist" from "belongs to another tenant".
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
  return service
}

export async function createService(ctx: AuthContext, input: CreateServiceInput) {
  requireRole(ctx, 'owner', 'admin')

  return serviceRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    name: input.name,
    description: input.description ?? null,
    priceFrom: input.priceFrom ?? null,
    priceTo: input.priceTo ?? null,
    // Snapshot the business currency at creation time — Service.currency
    // is stored independently so a later Business currency change never
    // silently rewrites the price of existing services.
    currency: input.currency ?? ctx.business.currency,
    durationMinutes: input.durationMinutes,
  })
}

export async function updateService(ctx: AuthContext, id: string, input: UpdateServiceInput) {
  requireRole(ctx, 'owner', 'admin')

  const existing = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }

  // The Zod schema only validates priceFrom/priceTo against each other when
  // BOTH are present in this particular PATCH payload. When only one side
  // is being changed, validate it against the side that isn't changing.
  const effectiveFrom = input.priceFrom !== undefined ? input.priceFrom : existing.priceFrom?.toNumber() ?? null
  const effectiveTo = input.priceTo !== undefined ? input.priceTo : existing.priceTo?.toNumber() ?? null
  if (effectiveFrom != null && effectiveTo != null && effectiveTo < effectiveFrom) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'priceTo must be greater than or equal to priceFrom')
  }

  const updated = await serviceRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
  return updated
}

/** Idempotent: deactivating an already-inactive service still succeeds. */
export async function deactivateService(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, 'owner', 'admin')

  const count = await serviceRepository.deactivate(ctx.tenant.id, ctx.business.id, id)
  if (count === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
}
