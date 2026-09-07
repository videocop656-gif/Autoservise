import type { UserRole } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'

/** Throws 403 unless ctx.user.role is one of the allowed roles. */
export function requireRole(ctx: AuthContext, ...roles: UserRole[]): void {
  if (!roles.includes(ctx.user.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
  }
}
