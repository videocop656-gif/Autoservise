import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { businessRepository } from '../repositories/businessRepository'
import type { BusinessProfileInput } from '../validation/business.schemas'

/**
 * The business is always the one resolved by requireAuth from the session
 * (ctx.tenant -> ctx.business) — callers never pass a business id in.
 */
export async function updateBusinessProfile(ctx: AuthContext, input: BusinessProfileInput) {
  requireRole(ctx, 'owner', 'admin')

  const updated = await businessRepository.update(ctx.tenant.id, ctx.business.id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Business not found')
  }
  return updated
}
