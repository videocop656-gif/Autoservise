/**
 * Reusable helper so tenant-owned queries can't accidentally omit the
 * tenant filter. Always build `where` clauses for tenant-owned models
 * through this function instead of writing `{ tenantId: ... }` by hand.
 *
 *   prisma.business.findMany({ where: withTenant(tenant.id) })
 *   prisma.business.findMany({ where: withTenant(tenant.id, { name: 'X' }) })
 *
 * `tenantId` must always come from the server-resolved AuthContext
 * (see requireAuth), never from client input.
 */
export function withTenant<T extends Record<string, unknown>>(
  tenantId: string,
  where: T = {} as T
): T & { tenantId: string } {
  return { ...where, tenantId }
}
