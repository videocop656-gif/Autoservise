import type { AppointmentStatus, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { DbClient } from '../db/transaction'
import { withTenant } from '../lib/tenantScope'
import { CAPACITY_CONSUMING_STATUSES } from '../domain/capacity'

/** Statuses that occupy a vehicle's time slot. Cancelled/completed/no-show never block a new booking. Same set as capacity (Prompt 50). */
export const CONFLICT_BLOCKING_STATUSES: AppointmentStatus[] = [...CAPACITY_CONSUMING_STATUSES]

/**
 * Upper bound on an appointment's length — appointmentService.assertDuration
 * and appointment.schemas.ts reject anything longer, so an appointment that
 * overlaps [start, end) must have started after start − 24 h. Lets the
 * capacity query use a bounded range on the existing
 * (tenantId, businessId, startAt) index instead of scanning all history.
 */
const MAX_APPOINTMENT_DURATION_MS = 24 * 60 * 60 * 1000

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

  // `db` (Prompt 50): pass a transaction client so the write happens under
  // the per-business scheduling lock (businessRepository.lockForScheduling).
  create(data: Prisma.AppointmentUncheckedCreateInput, db: DbClient = prisma) {
    return db.appointment.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.AppointmentUpdateInput, db: DbClient = prisma) {
    const result = await db.appointment.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return db.appointment.findFirst({ where: withTenant(tenantId, { businessId, id }) })
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
    excludeId?: string,
    db: DbClient = prisma
  ) {
    return db.appointment.findFirst({
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

  /**
   * Prompt 50 — the capacity-consuming appointments of one business that
   * overlap [startAt, endAt) (half-open, same predicate as findConflict),
   * any vehicle, optionally excluding the appointment being rescheduled.
   * Returns only the intervals — the capacity math (peak concurrency) lives
   * in domain/capacity.ts. One bounded query per check, never per slot.
   */
  listCapacityOccupants(
    tenantId: string,
    businessId: string,
    startAt: Date,
    endAt: Date,
    excludeId?: string,
    db: DbClient = prisma
  ) {
    return db.appointment.findMany({
      where: withTenant(tenantId, {
        businessId,
        status: { in: CONFLICT_BLOCKING_STATUSES },
        startAt: { lt: endAt, gt: new Date(startAt.getTime() - MAX_APPOINTMENT_DURATION_MS) },
        endAt: { gt: startAt },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      }),
      select: { startAt: true, endAt: true },
    })
  },
}
