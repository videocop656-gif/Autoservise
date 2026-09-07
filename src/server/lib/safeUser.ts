import type { User } from '@prisma/client'
import type { SafeUser } from '../types/auth'

/** Strips passwordHash (and anything else added to User later) before a user object ever leaves the server. */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}
