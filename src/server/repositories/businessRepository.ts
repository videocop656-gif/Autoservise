import type { Prisma } from '@prisma/client'
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
}
