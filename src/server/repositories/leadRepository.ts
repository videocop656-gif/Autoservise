import type { LeadStatus, LeadSource, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  status?: LeadStatus
  source?: LeadSource
  customerId?: string
  vehicleId?: string
  serviceId?: string
  search?: string
  skip: number
  take: number
}

function buildSearchOr(search: string): NonNullable<Prisma.LeadWhereInput['OR']> {
  return [{ subject: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }]
}

export const leadRepository = {
  async list(
    tenantId: string,
    businessId: string,
    { status, source, customerId, vehicleId, serviceId, search, skip, take }: ListOptions
  ) {
    const where = withTenant(tenantId, {
      businessId,
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
      ...(customerId ? { customerId } : {}),
      ...(vehicleId ? { vehicleId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(search ? { OR: buildSearchOr(search) } : {}),
    })
    const [items, total] = await Promise.all([
      // Newest first — this is a fixed convention for Leads, not a caller option.
      prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.lead.count({ where }),
    ])
    return { items, total }
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.lead.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  create(data: Prisma.LeadUncheckedCreateInput) {
    return prisma.lead.create({ data })
  },
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.LeadUpdateInput) {
    const result = await prisma.lead.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.lead.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
