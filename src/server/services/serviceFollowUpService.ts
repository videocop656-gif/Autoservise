import type { ServiceFollowUp, ServiceFollowUpStatus, ServiceRecord } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { businessLocalToUtc, toBusinessLocalDateTime } from '../lib/timezone'
import { serviceFollowUpRepository } from '../repositories/serviceFollowUpRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { createCustomerRequestSchema } from '../validation/customerRequest.schemas'
import type { UpdateServiceFollowUpInput } from '../validation/serviceFollowUp.schemas'
import type { PaginationParams } from '../lib/pagination'
import { createCustomerRequest } from './customerRequestService'

// ---------------------------------------------------------------------------
// Prompt 48 — Service Follow-up / Retention Loop.
//
// A follow-up is an operational reminder for staff ("time to pay attention
// to this customer again"), never an outbound message: nothing here sends
// anything, schedules anything, or runs in the background. It is created
// only after a ServiceRecord is successfully saved, surfaces in /operations
// when due, and is turned back into a CustomerRequest — closing the loop
// Customer → Request → Appointment → Service → ServiceRecord → History →
// Follow-up → Request.
// ---------------------------------------------------------------------------

// Explicit allow-list, same style as Appointment/CustomerRequest. BOOKED and
// DISMISSED are terminal. CONTACTED never goes back to PENDING: the work was
// handed to a CustomerRequest, which now owns it.
const ALLOWED_TRANSITIONS: Record<ServiceFollowUpStatus, ServiceFollowUpStatus[]> = {
  PENDING: ['CONTACTED', 'BOOKED', 'DISMISSED'],
  CONTACTED: ['BOOKED', 'DISMISSED'],
  BOOKED: [],
  DISMISSED: [],
}

const TERMINAL_STATUSES: ServiceFollowUpStatus[] = ['BOOKED', 'DISMISSED']

export function assertValidFollowUpTransition(from: ServiceFollowUpStatus, to: ServiceFollowUpStatus): void {
  if (from === to) return
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ApiError(400, 'INVALID_STATUS_TRANSITION', `Cannot change follow-up status from ${from} to ${to}`)
  }
}

/** Pure calendar math on a "YYYY-MM-DD" day key — no clock, no timezone. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

/** The stored dueAt for a Business-local due day: that day's local midnight, as UTC (DST-aware). */
export function followUpDueAtFromDateKey(dateKey: string, timeZone: string): Date {
  return businessLocalToUtc(dateKey, '00:00', timeZone)
}

/**
 * Case B: dueAt = performedAt + repeatIntervalDays, counted in whole
 * Business-local calendar days — a visit performed late in the evening
 * local time counts from that local day, not from its UTC day.
 */
export function followUpDueAtFromInterval(performedAt: Date, repeatIntervalDays: number, timeZone: string): Date {
  const { dateKey } = toBusinessLocalDateTime(performedAt, timeZone)
  return followUpDueAtFromDateKey(addDaysToDateKey(dateKey, repeatIntervalDays), timeZone)
}

export interface SyncFollowUpOptions {
  /** The "Следующий контакт" value: a day key, null (= none), or undefined (= not sent). */
  dueDate: string | null | undefined
  /** The record's Service.repeatIntervalDays. Only consulted on create. */
  repeatIntervalDays: number | null
  isCreate: boolean
}

/**
 * Creates/updates the one follow-up of a ServiceRecord after that record
 * was saved successfully. The rules (spec §7, §10):
 *   - explicit day → always wins over the interval (Case A);
 *   - on create with no day sent → the service's interval, if any (Case B);
 *   - no day and no interval → no follow-up (Case C);
 *   - an existing PENDING follow-up is updated in place, never duplicated
 *     (ServiceFollowUp.serviceRecordId is also @unique in the database);
 *   - a CONTACTED/BOOKED/DISMISSED follow-up is never replaced or
 *     re-created automatically;
 *   - clearing the day (null) on edit dismisses a PENDING follow-up —
 *     "очистка даты означает отсутствие follow-up".
 * Works identically for historical records without an Appointment.
 */
export async function syncFollowUpForServiceRecord(
  ctx: AuthContext,
  record: ServiceRecord,
  opts: SyncFollowUpOptions
): Promise<ServiceFollowUp | null> {
  const tz = ctx.business.timezone
  const existing = await serviceFollowUpRepository.findByServiceRecordId(ctx.tenant.id, ctx.business.id, record.id)

  let targetDueAt: Date | null | undefined
  if (typeof opts.dueDate === 'string') {
    targetDueAt = followUpDueAtFromDateKey(opts.dueDate, tz)
  } else if (opts.dueDate === null) {
    targetDueAt = null
  } else if (opts.isCreate && opts.repeatIntervalDays != null && opts.repeatIntervalDays > 0) {
    targetDueAt = followUpDueAtFromInterval(record.performedAt, opts.repeatIntervalDays, tz)
  }

  // Keep an open follow-up pointing at the record's current customer/
  // vehicle/service if an edit changed them.
  const copies = { customerId: record.customerId, vehicleId: record.vehicleId, serviceId: record.serviceId }

  if (targetDueAt === undefined) {
    if (existing?.status === 'PENDING' && hasDifferentCopies(existing, copies)) {
      return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, copies)
    }
    return existing
  }

  if (targetDueAt === null) {
    if (existing?.status === 'PENDING') {
      return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, { status: 'DISMISSED' })
    }
    return existing
  }

  if (!existing) {
    return serviceFollowUpRepository.create({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      ...copies,
      serviceRecordId: record.id,
      dueAt: targetDueAt,
      status: 'PENDING',
    })
  }

  if (existing.status === 'PENDING') {
    return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, { ...copies, dueAt: targetDueAt })
  }

  return existing
}

function hasDifferentCopies(
  followUp: ServiceFollowUp,
  copies: { customerId: string; vehicleId: string; serviceId: string }
): boolean {
  return followUp.customerId !== copies.customerId || followUp.vehicleId !== copies.vehicleId || followUp.serviceId !== copies.serviceId
}

export async function listServiceFollowUps(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: ServiceFollowUpStatus
    dueBefore?: Date
    customerId?: string
    vehicleId?: string
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return serviceFollowUpRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getServiceFollowUp(ctx: AuthContext, id: string) {
  const followUp = await serviceFollowUpRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!followUp) {
    throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
  }
  return followUp
}

// Operational, same as ServiceRecord/CustomerRequest: owner/admin/manager.
export async function updateServiceFollowUp(ctx: AuthContext, id: string, input: UpdateServiceFollowUpInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const existing = await getServiceFollowUp(ctx, id)

  if (input.status !== undefined) {
    assertValidFollowUpTransition(existing.status, input.status)
  }
  // "Отложить" only makes sense while the follow-up is still open.
  if (input.dueAt !== undefined && TERMINAL_STATUSES.includes(existing.status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot reschedule a ${existing.status} follow-up`)
  }

  const updated = await serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, id, {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.dueAt !== undefined ? { dueAt: followUpDueAtFromDateKey(input.dueAt, ctx.business.timezone) } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  })
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
  }
  return updated
}

const REQUEST_SUBJECT_MAX = 200

/**
 * "Создать обращение" (spec §11–§13). Idempotent: a follow-up that already
 * has a request returns that same request and never creates another. A new
 * request always starts at NEW with source MANUAL and the follow-up's own
 * customer/vehicle/service; the follow-up becomes CONTACTED — not BOOKED,
 * which only happens once the request is CONVERTED to a real appointment.
 */
export async function createCustomerRequestFromFollowUp(ctx: AuthContext, id: string) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const followUp = await getServiceFollowUp(ctx, id)

  if (followUp.customerRequestId) {
    return { followUp, request: await loadLinkedRequest(ctx, followUp.customerRequestId), created: false }
  }
  if (TERMINAL_STATUSES.includes(followUp.status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot create a customer request from a ${followUp.status} follow-up`)
  }

  const service = followUp.serviceId
    ? await serviceRepository.findById(ctx.tenant.id, ctx.business.id, followUp.serviceId)
    : null
  const subject = (service ? `Повторное обслуживание: ${service.name}` : 'Повторный контакт после обслуживания').slice(0, REQUEST_SUBJECT_MAX)

  // Through the request's own schema + service, so it is validated exactly
  // like a manually created request (active customer, vehicle belongs to
  // customer, active service, initial status history).
  const input = createCustomerRequestSchema.parse({
    customerId: followUp.customerId,
    vehicleId: followUp.vehicleId,
    ...(followUp.serviceId ? { serviceId: followUp.serviceId } : {}),
    source: 'MANUAL',
    subject,
    description: followUp.note ?? undefined,
  })
  const request = await createCustomerRequest(ctx, input)

  const linked = await serviceFollowUpRepository.linkCustomerRequest(ctx.tenant.id, ctx.business.id, id, request.id)
  const current = await getServiceFollowUp(ctx, id)
  if (!linked) {
    // A concurrent call linked its own request first — return that one.
    if (current.customerRequestId) {
      return { followUp: current, request: await loadLinkedRequest(ctx, current.customerRequestId), created: false }
    }
    throw new ApiError(409, 'CONFLICT', 'Follow-up changed while creating the customer request')
  }
  return { followUp: current, request, created: true }
}

async function loadLinkedRequest(ctx: AuthContext, customerRequestId: string) {
  const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, customerRequestId)
  if (!request) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
  }
  return request
}
