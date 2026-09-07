import type { AuthContext } from '../types/auth'
import { requireRole } from '../middleware/requireRole'
import { workingHoursRepository } from '../repositories/workingHoursRepository'
import type { WorkingHoursListInput } from '../validation/businessHours.schemas'

export function listWorkingHours(ctx: AuthContext) {
  return workingHoursRepository.listByBusiness(ctx.business.id)
}

/** Full-week replace, scoped to the current session's business. Owner/admin only. */
export async function replaceWorkingHours(ctx: AuthContext, days: WorkingHoursListInput) {
  requireRole(ctx, 'owner', 'admin')
  await workingHoursRepository.replaceAll(ctx.business.id, days)
  return workingHoursRepository.listByBusiness(ctx.business.id)
}
