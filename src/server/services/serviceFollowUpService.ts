import type { Prisma, ServiceFollowUp, ServiceFollowUpStatus, ServiceRecord } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { businessLocalToUtc, toBusinessLocalDateTime } from '../lib/timezone'
import { runInTransaction } from '../db/transaction'
import { withTenant } from '../lib/tenantScope'
import { serviceFollowUpRepository } from '../repositories/serviceFollowUpRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { appointmentRepository } from '../repositories/appointmentRepository'
import { createCustomerRequestSchema } from '../validation/customerRequest.schemas'
import type { UpdateServiceFollowUpInput } from '../validation/serviceFollowUp.schemas'
import type { PaginationParams } from '../lib/pagination'
import { prepareCustomerRequestCreate } from './customerRequestService'

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
  /**
   * Prompt 48.1 — this save archives the record (false → true). An archived
   * record keeps no open follow-up: a PENDING one becomes DISMISSED;
   * CONTACTED/BOOKED/DISMISSED history is never rewritten. Takes precedence
   * over any date sent in the same request.
   */
  archived?: boolean
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
 *
 * Prompt 48.1 — always called with the transaction `tx` in which the
 * ServiceRecord itself was written, so the record and its follow-up commit
 * together or not at all.
 */
export async function syncFollowUpForServiceRecord(
  ctx: AuthContext,
  record: ServiceRecord,
  opts: SyncFollowUpOptions,
  tx: Prisma.TransactionClient
): Promise<ServiceFollowUp | null> {
  const tz = ctx.business.timezone
  const existing = await serviceFollowUpRepository.findByServiceRecordId(ctx.tenant.id, ctx.business.id, record.id, tx)

  if (opts.archived) {
    if (existing?.status === 'PENDING') {
      return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, { status: 'DISMISSED' }, tx)
    }
    return existing
  }

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
      return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, copies, tx)
    }
    return existing
  }

  if (targetDueAt === null) {
    if (existing?.status === 'PENDING') {
      return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, { status: 'DISMISSED' }, tx)
    }
    return existing
  }

  if (!existing) {
    return serviceFollowUpRepository.create(
      {
        tenantId: ctx.tenant.id,
        businessId: ctx.business.id,
        ...copies,
        serviceRecordId: record.id,
        dueAt: targetDueAt,
        status: 'PENDING',
      },
      tx
    )
  }

  if (existing.status === 'PENDING') {
    return serviceFollowUpRepository.updateById(ctx.tenant.id, ctx.business.id, existing.id, { ...copies, dueAt: targetDueAt }, tx)
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
    if (input.status === 'BOOKED' && existing.status !== 'BOOKED') {
      await assertRepeatVisitIsBooked(ctx, existing)
    }
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

/**
 * Prompt 48.1 — the BOOKED invariant. BOOKED means a repeat visit really
 * exists: the follow-up's own CustomerRequest was CONVERTED (which the
 * request lifecycle only allows with an appointment) and that appointment
 * exists in this tenant/business. A manual PATCH can confirm that state but
 * never invent it — and nothing here ever creates an appointment.
 */
async function assertRepeatVisitIsBooked(ctx: AuthContext, followUp: ServiceFollowUp): Promise<void> {
  const notBooked = () =>
    new ApiError(
      400,
      'FOLLOW_UP_NOT_BOOKED',
      'A follow-up can only be BOOKED once its customer request is CONVERTED to an existing appointment'
    )
  if (!followUp.customerRequestId) throw notBooked()
  const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, followUp.customerRequestId)
  if (!request || request.status !== 'CONVERTED' || !request.appointmentId) throw notBooked()
  const appointment = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, request.appointmentId)
  if (!appointment) throw notBooked()
}

const REQUEST_SUBJECT_MAX = 200

/**
 * "Создать обращение" (spec §11–§13). Idempotent under any concurrency
 * (Prompt 48.1). A new request always starts at NEW with source MANUAL and
 * the follow-up's own customer/vehicle/service; the follow-up becomes
 * CONTACTED — not BOOKED, which only happens once the request is CONVERTED.
 *
 * Two phases:
 *  1. Reads, outside any transaction: the follow-up, the service name and
 *     the request's full validation (prepareCustomerRequestCreate).
 *  2. One short transaction that uses only its own connection: lock the
 *     follow-up row (SELECT … FOR UPDATE), re-check it, insert the request +
 *     history, link it. Concurrent calls queue on the row lock; the first
 *     one links, every later one sees customerRequestId and returns that
 *     same request. If anything fails, the insert rolls back with the link —
 *     no orphan request. Doing the reads first matters: a transaction that
 *     holds the lock and then asks the pool for a second connection can
 *     starve behind the very callers waiting on its lock.
 */
export async function createCustomerRequestFromFollowUp(ctx: AuthContext, id: string) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const snapshot = await getServiceFollowUp(ctx, id)
  if (snapshot.customerRequestId) {
    return { followUp: snapshot, request: await loadLinkedRequest(ctx, snapshot.customerRequestId), created: false }
  }
  assertCanCreateRequest(snapshot)

  const service = snapshot.serviceId ? await serviceRepository.findById(ctx.tenant.id, ctx.business.id, snapshot.serviceId) : null
  const subject = (service ? `Повторное обслуживание: ${service.name}` : 'Повторный контакт после обслуживания').slice(0, REQUEST_SUBJECT_MAX)

  // Through the request's own schema + validation, exactly like a manually
  // created request (active customer, vehicle belongs to customer, active
  // service); only the insert itself happens inside the transaction below.
  const input = createCustomerRequestSchema.parse({
    customerId: snapshot.customerId,
    vehicleId: snapshot.vehicleId,
    ...(snapshot.serviceId ? { serviceId: snapshot.serviceId } : {}),
    source: 'MANUAL',
    subject,
    description: snapshot.note ?? undefined,
  })
  const requestData = await prepareCustomerRequestCreate(ctx, input)

  return runInTransaction(async (tx) => {
    const followUp = await serviceFollowUpRepository.findByIdForUpdate(ctx.tenant.id, ctx.business.id, id, tx)
    if (!followUp) {
      throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
    }
    if (followUp.customerRequestId) {
      return { followUp, request: await loadLinkedRequest(ctx, followUp.customerRequestId, tx), created: false }
    }
    assertCanCreateRequest(followUp)
    if (
      followUp.customerId !== snapshot.customerId ||
      followUp.vehicleId !== snapshot.vehicleId ||
      followUp.serviceId !== snapshot.serviceId
    ) {
      // Edited between the validation reads and the lock — never insert a
      // request validated against stale data; the caller can simply retry.
      throw new ApiError(409, 'CONFLICT', 'The follow-up changed while creating the customer request — please retry')
    }

    const request = await customerRequestRepository.createWithInitialHistory(requestData, ctx.user.id, tx)
    const linked = await serviceFollowUpRepository.updateById(
      ctx.tenant.id,
      ctx.business.id,
      id,
      { customerRequestId: request.id, status: 'CONTACTED' },
      tx
    )
    if (!linked) {
      throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
    }
    return { followUp: linked, request, created: true }
  })
}

function assertCanCreateRequest(followUp: ServiceFollowUp): void {
  if (TERMINAL_STATUSES.includes(followUp.status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot create a customer request from a ${followUp.status} follow-up`)
  }
}

/** The linked request — through `tx` inside the locked transaction, so it needs no second connection. */
async function loadLinkedRequest(ctx: AuthContext, customerRequestId: string, tx?: Prisma.TransactionClient) {
  const request = tx
    ? await tx.customerRequest.findFirst({ where: withTenant(ctx.tenant.id, { businessId: ctx.business.id, id: customerRequestId }) })
    : await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, customerRequestId)
  if (!request) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
  }
  return request
}
