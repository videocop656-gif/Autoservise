import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const serviceRepository = {
  listByBusiness(tenantId: string, businessId: string, activeOnly: boolean) {
    return prisma.service.findMany({
      where: withTenant(tenantId, { businessId, ...(activeOnly ? { isActive: true } : {}) }),
      orderBy: { createdAt: 'asc' },
    })
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.service.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  create(data: Prisma.ServiceUncheckedCreateInput) {
    return prisma.service.create({ data })
  },
  /** Scoped update: only touches the row matching (id, businessId, tenantId). Returns null if none matched. */
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ServiceUpdateInput) {
    const result = await prisma.service.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data,
    })
    if (result.count === 0) return null
    return prisma.service.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  /** Idempotent: sets isActive=false regardless of its current value. Returns the number of rows matched (0 = not found / foreign tenant). */
  async deactivate(tenantId: string, businessId: string, id: string): Promise<number> {
    const result = await prisma.service.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive: false },
    })
    return result.count
  },
}
