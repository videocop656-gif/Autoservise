import type { Tenant, UserRole } from '@prisma/client'

/** User shape that is safe to return to the client: never includes passwordHash. */
export interface SafeUser {
  id: string
  tenantId: string
  email: string
  name: string
  role: UserRole
  createdAt: Date
  updatedAt: Date
}

/** Server-resolved identity for the current request. Never trust client-sent tenantId/userId/role instead of this. */
export interface AuthContext {
  user: SafeUser
  tenant: Tenant
  sessionId: string
}
