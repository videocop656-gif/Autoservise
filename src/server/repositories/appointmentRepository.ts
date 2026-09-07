import type { AppointmentStatus, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

/** Statuses that occupy a vehicle's time slot. Cancelled/completed/no-show never block a new booking. */
export const CONFLICT_BLOCKING_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS']

interface ListOptions {
  status?: AppointmentStatus
  customerId?: string
  vehicleId?: string
  serviceId?: string
  dateFrom?: Date
  dateTo?: Date
  includeCancelled: boolean
  skip: number
  take: number
}

export const appointmentRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      // An explicit status filter always wins; only the *default* (no
      // status filter) view hides CANCELLED unless includeCancelled=true.
      ...(opts.status ? { status: opts.status } : opts.includeCancelled ? {} : { status: { not: 'CANCELLED' as AppointmentStatus } }),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
      ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
      ...(opts.dateFrom || opts.dateTo
        ? {
            startAt: {
              ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
              ...(opts.dateTo ? { lt: opts.dateTo } : {}),
            },
          }
        : {}),
    })
    const [items, total] = await Promise.all([
      prisma.appointment.findMany({ where, orderBy: { startAt: 'asc' }, skip: opts.skip, take: opts.take }),
      prisma.appointment.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.appointment.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  create(data: Prisma.AppointmentUncheckedCreateInput) {
    return prisma.appointment.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.AppointmentUpdateInput) {
    const result = await prisma.appointment.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.appointment.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Standard interval-overlap check (existing.start < new.end AND
   * existing.end > new.start), scoped to one vehicle, excluding
   * CANCELLED/COMPLETED/NO_SHOW (they never block a slot) and optionally
   * excluding the appointment being updated (so it never conflicts with itself).
   */
  findConflict(
    tenantId: string,
    businessId: string,
    vehicleId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string
  ) {
    return prisma.appointment.findFirst({
      where: withTenant(tenantId, {
        businessId,
        vehicleId,
        status: { in: CONFLICT_BLOCKING_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      }),
    })
  },
}
