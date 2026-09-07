import type { Prisma, CustomerRequestStatus, CustomerRequestSource } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  status?: CustomerRequestStatus
  source?: CustomerRequestSource
  customerId?: string
  vehicleId?: string
  serviceId?: string
  appointmentId?: string
  search?: string
  skip: number
  take: number
}

interface HistoryEntry {
  fromStatus: CustomerRequestStatus | null
  toStatus: CustomerRequestStatus
  changedByUserId: string | null
}

/** Thrown inside updateWithStatusHistory to abort the transaction without writing a history row for a request this tenant doesn't own. */
class UpdateNotMatchedError extends Error {}

function buildSearchOr(search: string): NonNullable<Prisma.CustomerRequestWhereInput['OR']> {
  return [{ subject: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }]
}

export const customerRequestRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
      ...(opts.appointmentId ? { appointmentId: opts.appointmentId } : {}),
      ...(opts.search ? { OR: buildSearchOr(opts.search) } : {}),
    })
    const [items, total] = await Promise.all([
      // Newest first — same fixed convention as Lead/ServiceRecord, not a caller option.
      prisma.customerRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: opts.skip, take: opts.take }),
      prisma.customerRequest.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.customerRequest.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /** Used by GET single — always includes the audit trail, oldest first, with the changing user's display name. */
  findByIdWithHistory(tenantId: string, businessId: string, id: string) {
    return prisma.customerRequest.findFirst({
      where: withTenant(tenantId, { businessId, id }),
      include: {
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedByUser: { select: { name: true } } },
        },
      },
    })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.CustomerRequestUpdateInput) {
    const result = await prisma.customerRequest.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.customerRequest.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Atomically creates the CustomerRequest together with its initial
   * (null -> NEW) status history row. Uses an interactive transaction
   * (new to this codebase — the project's one prior $transaction use,
   * workingHoursRepository.replaceAll, uses the simpler array form) because
   * the history row needs the row's generated id, which an array-form
   * transaction can't thread between two operations.
   */
  createWithInitialHistory(data: Prisma.CustomerRequestUncheckedCreateInput, changedByUserId: string | null) {
    return prisma.$transaction(async (tx) => {
      const created = await tx.customerRequest.create({ data })
      await tx.customerRequestStatusHistory.create({
        data: {
          tenantId: created.tenantId,
          businessId: created.businessId,
          customerRequestId: created.id,
          fromStatus: null,
          toStatus: created.status,
          changedByUserId,
        },
      })
      return created
    })
  },

  /**
   * Atomically applies a status-changing PATCH together with its history
   * row. The updateMany is tenant-scoped exactly like updateById; if it
   * matches zero rows (foreign tenant, or a genuine race with something
   * else), the transaction is rolled back before any history row is
   * written, so a request this tenant doesn't own can never end up with a
   * history entry attributed to it.
   */
  async updateWithStatusHistory(
    tenantId: string,
    businessId: string,
    id: string,
    data: Prisma.CustomerRequestUpdateInput,
    historyEntry: HistoryEntry
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const result = await tx.customerRequest.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
        if (result.count === 0) {
          throw new UpdateNotMatchedError()
        }
        await tx.customerRequestStatusHistory.create({
          data: { tenantId, businessId, customerRequestId: id, ...historyEntry },
        })
        return tx.customerRequest.findFirst({ where: withTenant(tenantId, { businessId, id }) })
      })
    } catch (err) {
      if (err instanceof UpdateNotMatchedError) return null
      throw err
    }
  },
}
