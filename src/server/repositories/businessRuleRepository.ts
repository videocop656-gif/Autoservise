import type { BusinessRuleCategory, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  activeOnly: boolean
  category?: BusinessRuleCategory
}

export const businessRuleRepository = {
  listByBusiness(tenantId: string, businessId: string, { activeOnly, category }: ListOptions) {
    return prisma.businessRule.findMany({
      where: withTenant(tenantId, {
        businessId,
        ...(activeOnly ? { isActive: true } : {}),
        ...(category ? { category } : {}),
      }),
      // Lower priority number = higher importance, so it sorts first;
      // createdAt is the tie-breaker for equal-priority rules.
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    })
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.businessRule.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  create(data: Prisma.BusinessRuleUncheckedCreateInput) {
    return prisma.businessRule.create({ data })
  },
  /** Scoped update: only touches the row matching (id, businessId, tenantId). Returns null if none matched. */
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.BusinessRuleUpdateInput) {
    const result = await prisma.businessRule.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data,
    })
    if (result.count === 0) return null
    return prisma.businessRule.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  /** Idempotent: sets isActive=false regardless of its current value. Returns rows matched (0 = not found / foreign tenant). */
  async deactivate(tenantId: string, businessId: string, id: string): Promise<number> {
    const result = await prisma.businessRule.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive: false },
    })
    return result.count
  },
}
