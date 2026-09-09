import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const channelConnectionRepository = {
  list(tenantId: string, businessId: string) {
    return prisma.channelConnection.findMany({ where: withTenant(tenantId, { businessId }), orderBy: { createdAt: 'desc' } })
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  create(data: Prisma.ChannelConnectionUncheckedCreateInput) {
    return prisma.channelConnection.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ChannelConnectionUpdateInput) {
    const result = await prisma.channelConnection.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  async setStatus(tenantId: string, businessId: string, id: string, status: 'ACTIVE' | 'INACTIVE') {
    const result = await prisma.channelConnection.updateMany({ where: withTenant(tenantId, { businessId, id }), data: { status } })
    if (result.count === 0) return null
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
