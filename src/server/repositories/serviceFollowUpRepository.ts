import type { Prisma, ServiceFollowUpStatus } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  status?: ServiceFollowUpStatus
  /** Exclusive upper bound on dueAt — "due before this instant". */
  dueBefore?: Date
  customerId?: string
  vehicleId?: string
  skip: number
  take: number
}

// Prompt 48 — every query is scoped by tenantId + businessId (withTenant),
// exactly like every other repository: a follow-up of another tenant is
// indistinguishable from one that doesn't exist.
export const serviceFollowUpRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.dueBefore ? { dueAt: { lt: opts.dueBefore } } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
    })
    const [items, total] = await Promise.all([
      prisma.serviceFollowUp.findMany({
        where,
        // Earliest due first (overdue → today → upcoming); createdAt breaks ties.
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.serviceFollowUp.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  findByServiceRecordId(tenantId: string, businessId: string, serviceRecordId: string) {
    return prisma.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, serviceRecordId }) })
  },

  create(data: Prisma.ServiceFollowUpUncheckedCreateInput) {
    return prisma.serviceFollowUp.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ServiceFollowUpUncheckedUpdateManyInput) {
    const result = await prisma.serviceFollowUp.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Links a newly created CustomerRequest to a follow-up — but only if no
   * request is linked yet and the follow-up is still open. The condition is
   * part of the UPDATE itself, so of two concurrent "Создать обращение"
   * clicks at most one can ever win the link. Returns whether it won.
   */
  async linkCustomerRequest(tenantId: string, businessId: string, id: string, customerRequestId: string): Promise<boolean> {
    const result = await prisma.serviceFollowUp.updateMany({
      where: withTenant(tenantId, {
        businessId,
        id,
        customerRequestId: null,
        status: { in: ['PENDING', 'CONTACTED'] satisfies ServiceFollowUpStatus[] },
      }),
      data: { customerRequestId, status: 'CONTACTED' },
    })
    return result.count > 0
  },

  /**
   * The linked CustomerRequest became CONVERTED — which the request
   * lifecycle only allows with a real appointment — so the repeat visit is
   * genuinely booked. Only open follow-ups move; terminal ones never change.
   */
  async markBookedByCustomerRequest(tenantId: string, businessId: string, customerRequestId: string): Promise<number> {
    const result = await prisma.serviceFollowUp.updateMany({
      where: withTenant(tenantId, {
        businessId,
        customerRequestId,
        status: { in: ['PENDING', 'CONTACTED'] satisfies ServiceFollowUpStatus[] },
      }),
      data: { status: 'BOOKED' },
    })
    return result.count
  },
}
