import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const businessRepository = {
  findFirstByTenant(tenantId: string) {
    return prisma.business.findFirst({ where: withTenant(tenantId) })
  },
  listByTenant(tenantId: string) {
    return prisma.business.findMany({ where: withTenant(tenantId) })
  },
}
