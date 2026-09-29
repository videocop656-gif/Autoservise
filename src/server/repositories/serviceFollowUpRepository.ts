import { Prisma, type ServiceFollowUpStatus } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { DbClient } from '../db/transaction'
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

  // `db` (Prompt 48.1): pass a transaction client so the follow-up change
  // commits or rolls back together with the ServiceRecord / CustomerRequest
  // write it belongs to.
  findByServiceRecordId(tenantId: string, businessId: string, serviceRecordId: string, db: DbClient = prisma) {
    return db.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, serviceRecordId }) })
  },

  create(data: Prisma.ServiceFollowUpUncheckedCreateInput, db: DbClient = prisma) {
    return db.serviceFollowUp.create({ data })
  },

  async updateById(
    tenantId: string,
    businessId: string,
    id: string,
    data: Prisma.ServiceFollowUpUncheckedUpdateManyInput,
    db: DbClient = prisma
  ) {
    const result = await db.serviceFollowUp.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return db.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Prompt 48.1 — reads one follow-up and takes a PostgreSQL row lock on it
   * (SELECT … FOR UPDATE) for the rest of the caller's transaction. Must be
   * called with a transaction client. A concurrent transaction asking for
   * the same row waits here until this one commits, then sees its result —
   * which is what makes "Создать обращение" produce exactly one request no
   * matter how many calls race. Tenant/business scoped like every other
   * query: a foreign id locks nothing and returns null.
   */
  async findByIdForUpdate(tenantId: string, businessId: string, id: string, tx: Prisma.TransactionClient) {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "service_follow_ups" WHERE "id" = ${id} AND "tenantId" = ${tenantId} AND "businessId" = ${businessId} FOR UPDATE`
    )
    if (locked.length === 0) return null
    return tx.serviceFollowUp.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * The linked CustomerRequest became CONVERTED — which the request
   * lifecycle only allows with a real appointment — so the repeat visit is
   * genuinely booked. Only open follow-ups move; terminal ones never change.
   * Runs inside the request's own status-change transaction (Prompt 48.1).
   */
  async markBookedByCustomerRequest(tenantId: string, businessId: string, customerRequestId: string, db: DbClient = prisma): Promise<number> {
    const result = await db.serviceFollowUp.updateMany({
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
