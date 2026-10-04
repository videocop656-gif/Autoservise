import type { Business, Tenant, UserRole } from '@prisma/client'

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

/**
 * Server-resolved identity for the current request. Never trust
 * client-sent tenantId/userId/role/businessId instead of this — `business`
 * is resolved the same way tenant is: from the session, not from the
 * request. Every tenant has exactly one Business at this stage.
 */
export interface AuthContext {
  user: SafeUser
  tenant: Tenant
  business: Business
  sessionId: string
}

/**
 * MCR-5 — the tenant + business an operation runs for, with NO user. A staff
 * AuthContext satisfies it as-is; an automation (the AI auto-reply worker)
 * builds it from its own durable record — never a synthetic user. Only
 * functions that genuinely never read ctx.user / ctx.sessionId and never
 * check a role take this type.
 */
export type BusinessScope = Pick<AuthContext, 'tenant' | 'business'>
