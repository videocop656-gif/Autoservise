import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const businessRepository = {
  findFirstByTenant(tenantId: string) {
    return prisma.business.findFirst({ where: withTenant(tenantId) })
  },
  listByTenant(tenantId: string) {
    return prisma.business.findMany({ where: withTenant(tenantId) })
  },
  /**
   * Scoped update: only ever touches the row identified by (id, tenantId).
   * Returns null if no row matched (wrong tenant or unknown id), letting
   * callers respond 404 without a separate existence check.
   */
  async update(tenantId: string, businessId: string, data: Prisma.BusinessUpdateInput) {
    const result = await prisma.business.updateMany({
      where: withTenant(tenantId, { id: businessId }),
      data,
    })
    if (result.count === 0) return null
    return prisma.business.findFirst({ where: withTenant(tenantId, { id: businessId }) })
  },

  /**
   * Prompt 50 — the per-business scheduling lock. Takes a row lock on the
   * business (SELECT … FOR NO KEY UPDATE) for the rest of the caller's
   * transaction and returns its current capacity, so concurrent bookings of
   * the same business queue here and each one counts the others' committed
   * appointments. FOR NO KEY UPDATE, not FOR UPDATE: it serializes bookings
   * (and profile edits) of this one business without blocking unrelated
   * inserts that merely reference it (customers, messages, …), which take
   * FOR KEY SHARE. Tenant-scoped: a foreign id locks nothing, returns null.
   * Must be called with a transaction client.
   */
  async lockForScheduling(tenantId: string, businessId: string, tx: Prisma.TransactionClient): Promise<{ serviceBayCapacity: number } | null> {
    const rows = await tx.$queryRaw<{ serviceBayCapacity: number }[]>(
      Prisma.sql`SELECT "serviceBayCapacity" FROM "businesses" WHERE "id" = ${businessId} AND "tenantId" = ${tenantId} FOR NO KEY UPDATE`
    )
    return rows[0] ?? null
  },
}
