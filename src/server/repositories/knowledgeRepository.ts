import type { KnowledgeCategory, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  activeOnly: boolean
  category?: KnowledgeCategory
}

export const knowledgeRepository = {
  listByBusiness(tenantId: string, businessId: string, { activeOnly, category }: ListOptions) {
    return prisma.knowledgeItem.findMany({
      where: withTenant(tenantId, {
        businessId,
        ...(activeOnly ? { isActive: true } : {}),
        ...(category ? { category } : {}),
      }),
      orderBy: { createdAt: 'asc' },
    })
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.knowledgeItem.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  create(data: Prisma.KnowledgeItemUncheckedCreateInput) {
    return prisma.knowledgeItem.create({ data })
  },
  /** Scoped update: only touches the row matching (id, businessId, tenantId). Returns null if none matched. */
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.KnowledgeItemUpdateInput) {
    const result = await prisma.knowledgeItem.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data,
    })
    if (result.count === 0) return null
    return prisma.knowledgeItem.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  /** Idempotent: sets isActive=false regardless of its current value. Returns rows matched (0 = not found / foreign tenant). */
  async deactivate(tenantId: string, businessId: string, id: string): Promise<number> {
    const result = await prisma.knowledgeItem.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive: false },
    })
    return result.count
  },
}
