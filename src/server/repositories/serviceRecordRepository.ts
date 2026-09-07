import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  customerId?: string
  vehicleId?: string
  serviceId?: string
  dateFrom?: Date
  dateTo?: Date
  includeArchived: boolean
  skip: number
  take: number
}

export const serviceRecordRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.includeArchived ? {} : { isArchived: false }),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
      ...(opts.dateFrom || opts.dateTo
        ? {
            performedAt: {
              ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
              ...(opts.dateTo ? { lt: opts.dateTo } : {}),
            },
          }
        : {}),
    })
    const [items, total] = await Promise.all([
      prisma.serviceRecord.findMany({
        where,
        // Newest service visit first; createdAt is the tie-breaker for
        // records with an identical performedAt.
        orderBy: [{ performedAt: 'desc' }, { createdAt: 'desc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.serviceRecord.count({ where }),
    ])
    return { items, total }
  },

  // Archived records are still directly reachable by id — archiving only
  // hides a record from the default list, it never revokes access to it.
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.serviceRecord.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  create(data: Prisma.ServiceRecordUncheckedCreateInput) {
    return prisma.serviceRecord.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ServiceRecordUpdateInput) {
    const result = await prisma.serviceRecord.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.serviceRecord.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Highest mileage among this vehicle's other non-archived records —
   * the baseline a new/updated mileage value must not fall below. Returns
   * null when there is no such record, or none of them has a mileage set
   * (nulls never participate in the comparison).
   */
  async findMaxActiveMileage(tenantId: string, businessId: string, vehicleId: string, excludeId?: string): Promise<number | null> {
    const result = await prisma.serviceRecord.aggregate({
      where: withTenant(tenantId, {
        businessId,
        vehicleId,
        isArchived: false,
        mileage: { not: null },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      }),
      _max: { mileage: true },
    })
    return result._max.mileage
  },
}
