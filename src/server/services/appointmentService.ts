import type { Appointment, AppointmentStatus, Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { toBusinessLocalDateTime, businessLocalToUtc } from '../lib/timezone'
import { runInTransaction, type DbClient } from '../db/transaction'
import {
  capacitySnapshot,
  consumesCapacity,
  CAPACITY_EXCEEDED_CODE,
  CAPACITY_EXCEEDED_MESSAGE,
  type CapacitySnapshot,
} from '../domain/capacity'
import { appointmentRepository } from '../repositories/appointmentRepository'
import { businessRepository } from '../repositories/businessRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { workingHoursRepository } from '../repositories/workingHoursRepository'
import type { CreateAppointmentInput, UpdateAppointmentInput } from '../validation/appointment.schemas'
import type { PaginationParams } from '../lib/pagination'

const MIN_DURATION_MS = 15 * 60 * 1000
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

// Terminal statuses (COMPLETED/CANCELLED/NO_SHOW) never reopen. Everything
// else follows the specific forward-only paths below — no generic state
// machine library, just an explicit allow-list.
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

const TERMINAL_STATUSES: AppointmentStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW']

function assertValidTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) return
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot change appointment status from ${from} to ${to}`)
  }
}

function assertDuration(startAt: Date, endAt: Date): void {
  const duration = endAt.getTime() - startAt.getTime()
  if (duration <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'endAt must be after startAt')
  }
  if (duration < MIN_DURATION_MS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment must be at least 15 minutes')
  }
  if (duration > MAX_DURATION_MS) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment cannot exceed 24 hours')
  }
}

/** The 400 messages assertWithinWorkingHours throws — lets a caller tell "outside hours" apart from other validation errors. */
export const WORKING_HOURS_ERROR_MESSAGES: readonly string[] = [
  'Appointment cannot cross local midnight',
  'Business is closed on this day',
  'Appointment must be within business working hours',
]

/**
 * Validates the interval against BusinessWorkingHours, entirely in the
 * Business's own local timezone (never UTC hours, never the server's or a
 * user's timezone) — per Prompt 05's explicit requirement. Reuses the exact
 * same working-hours data source as GET/PUT /api/business/hours
 * (workingHoursRepository, from Prompt 02); no second schedule is created.
 */
async function assertWithinWorkingHours(ctx: AuthContext, startAt: Date, endAt: Date): Promise<void> {
  const timezone = ctx.business.timezone
  const localStart = toBusinessLocalDateTime(startAt, timezone)
  const localEnd = toBusinessLocalDateTime(endAt, timezone)

  if (localStart.dateKey !== localEnd.dateKey) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment cannot cross local midnight')
  }

  const days = await workingHoursRepository.listByBusiness(ctx.business.id)
  const day = days.find((d) => d.dayOfWeek === localStart.dayOfWeek)

  if (!day || !day.isOpen || !day.openTime || !day.closeTime) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Business is closed on this day')
  }

  // "HH:mm" strings compare correctly as plain strings within a single day.
  // Boundaries are inclusive: start === openTime and end === closeTime are both valid.
  if (localStart.timeKey < day.openTime || localEnd.timeKey > day.closeTime) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment must be within business working hours')
  }
}

interface EntityRefs {
  customerId: string
  vehicleId: string
  serviceId: string
}

/**
 * Verifies customer/vehicle/service all belong to the current tenant+
 * business, that the vehicle belongs to the given customer, and that all
 * three are currently active. A foreign-tenant reference is 404 (don't
 * reveal it exists); a same-tenant mismatch or inactive record is 400 (it
 * exists, it's just not usable for a new/changed booking right now).
 */
async function assertEntitiesActiveAndOwned(ctx: AuthContext, refs: EntityRefs): Promise<void> {
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, refs.customerId)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  if (!customer.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Customer is not active')
  }

  const vehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, refs.vehicleId)
  if (!vehicle) {
    throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
  }
  if (vehicle.customerId !== refs.customerId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Vehicle does not belong to the specified customer')
  }
  if (!vehicle.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Vehicle is not active')
  }

  const service = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, refs.serviceId)
  if (!service) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
  if (!service.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Service is not active')
  }
}

async function assertNoConflict(
  ctx: AuthContext,
  vehicleId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
  db?: DbClient
): Promise<void> {
  const conflict = await appointmentRepository.findConflict(ctx.tenant.id, ctx.business.id, vehicleId, startAt, endAt, excludeId, db)
  if (conflict) {
    throw new ApiError(409, 'APPOINTMENT_CONFLICT', 'This vehicle already has a conflicting appointment', {
      conflictingAppointmentId: conflict.id,
    })
  }
}

// --- Capacity (Prompt 50) --------------------------------------------------
//
// Business.serviceBayCapacity = how many vehicles can be serviced at once.
// The math lives in domain/capacity.ts; this is the only place that feeds it
// with appointments, so create, reschedule, the availability endpoint and
// the slot generator (AI check_availability) all agree.

/**
 * Read-only capacity of [startAt, endAt) for the current business — no lock.
 * What GET /api/appointments/availability and future booking/AI callers use
 * to ask "is there a free post?". `excludeAppointmentId` ignores the
 * appointment being rescheduled, exactly like the update path.
 */
export async function getIntervalCapacity(
  ctx: AuthContext,
  startAt: Date,
  endAt: Date,
  excludeAppointmentId?: string,
  db?: DbClient,
  capacity: number = ctx.business.serviceBayCapacity
): Promise<CapacitySnapshot> {
  const occupants = await appointmentRepository.listCapacityOccupants(ctx.tenant.id, ctx.business.id, startAt, endAt, excludeAppointmentId, db)
  return capacitySnapshot(capacity, occupants, startAt, endAt)
}

/**
 * Runs `write` under the per-business scheduling lock: one short
 * transaction that locks the business row, re-reads its capacity, re-checks
 * the vehicle conflict and (when `checkCapacity`) the capacity against the
 * committed state, then writes. Concurrent bookings of the same business
 * queue on the lock, so the last free post can only be taken once; any
 * failure rolls the whole thing back.
 */
async function withSchedulingLock<T>(
  ctx: AuthContext,
  check: { vehicleId: string; startAt: Date; endAt: Date; excludeId?: string; checkCapacity: boolean },
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<T> {
  return runInTransaction(async (tx) => {
    const locked = await businessRepository.lockForScheduling(ctx.tenant.id, ctx.business.id, tx)
    if (!locked) {
      throw new ApiError(404, 'NOT_FOUND', 'Business not found')
    }
    if (afterLock) await afterLock(tx)
    await assertNoConflict(ctx, check.vehicleId, check.startAt, check.endAt, check.excludeId, tx)
    if (check.checkCapacity) {
      const snapshot = await getIntervalCapacity(ctx, check.startAt, check.endAt, check.excludeId, tx, locked.serviceBayCapacity)
      if (!snapshot.available) {
        // No details: which appointments hold the posts is not the caller's business.
        throw new ApiError(409, CAPACITY_EXCEEDED_CODE, CAPACITY_EXCEEDED_MESSAGE)
      }
    }
    return write(tx)
  })
}

export async function listAppointments(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: AppointmentStatus
    customerId?: string
    vehicleId?: string
    serviceId?: string
    dateFrom?: Date
    dateTo?: Date
    includeCancelled: boolean
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return appointmentRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getAppointment(ctx: AuthContext, id: string) {
  const appointment = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!appointment) {
    throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
  }
  return appointment
}

// Manager can create/update appointments — this is operational workflow,
// unlike the Settings-style entities (Business/Service/Knowledge/Rules)
// where manager is read-only. Spelled out explicitly (rather than skipped)
// so the intent is documented and this stays correct if roles ever change.
/**
 * Prompt 56 — lets a caller make the booking part of a larger atomic step
 * (a CustomerRequest converted into this appointment) without a second
 * booking path: both hooks run inside the same scheduling transaction, and
 * anything they throw rolls the appointment back too.
 */
export interface CreateAppointmentHooks {
  /** Right after the business lock, before the vehicle-conflict/capacity checks. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>
  /** Right after the insert. */
  afterCreate?: (tx: Prisma.TransactionClient, appointment: Appointment) => Promise<void>
}

export async function createAppointment(ctx: AuthContext, input: CreateAppointmentInput, hooks: CreateAppointmentHooks = {}) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const refs = { customerId: input.customerId, vehicleId: input.vehicleId, serviceId: input.serviceId }
  await assertEntitiesActiveAndOwned(ctx, refs)
  assertDuration(input.startAt, input.endAt)
  await assertWithinWorkingHours(ctx, input.startAt, input.endAt)

  // Vehicle conflict + capacity are checked under the scheduling lock, so a
  // concurrent booking can't slip in between the check and the insert.
  const check = { vehicleId: input.vehicleId, startAt: input.startAt, endAt: input.endAt, checkCapacity: true }
  return withSchedulingLock(
    ctx,
    check,
    async (tx) => {
      const appointment = await appointmentRepository.create(
        {
          tenantId: ctx.tenant.id,
          businessId: ctx.business.id,
          customerId: input.customerId,
          vehicleId: input.vehicleId,
          serviceId: input.serviceId,
          startAt: input.startAt,
          endAt: input.endAt,
          status: input.status ?? 'SCHEDULED',
          notes: input.notes ?? null,
        },
        tx
      )
      if (hooks.afterCreate) await hooks.afterCreate(tx, appointment)
      return appointment
    },
    hooks.afterLock
  )
}

export async function updateAppointment(ctx: AuthContext, id: string, input: UpdateAppointmentInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const existing = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
  }

  if (input.status !== undefined) {
    assertValidTransition(existing.status, input.status)
  }

  const effectiveCustomerId = input.customerId ?? existing.customerId
  const effectiveVehicleId = input.vehicleId ?? existing.vehicleId
  const effectiveServiceId = input.serviceId ?? existing.serviceId
  const effectiveStartAt = input.startAt ?? existing.startAt
  const effectiveEndAt = input.endAt ?? existing.endAt

  const relationsChanged = input.customerId !== undefined || input.vehicleId !== undefined || input.serviceId !== undefined
  const timeChanged = input.startAt !== undefined || input.endAt !== undefined

  // A terminal appointment (COMPLETED/CANCELLED/NO_SHOW) can never leave
  // that status (assertValidTransition above already guarantees that), but
  // until Prompt 10 nothing stopped its *time or relations* from being
  // silently changed by a PATCH that didn't touch `status` at all — a real
  // gap relative to "rescheduling/cancelling must respect the existing
  // lifecycle" (Prompt 10's reschedule/cancel tools need this guarantee,
  // and it was already a latent correctness issue on the plain REST API
  // too). Plain field edits (e.g. notes) on a terminal appointment remain
  // allowed, same historical-editing principle as everywhere else in this
  // app — only time/relation changes are blocked.
  if ((timeChanged || relationsChanged) && TERMINAL_STATUSES.includes(existing.status)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot modify a ${existing.status} appointment's time or relations`)
  }

  // Only re-validate what's actually changing. In particular, a
  // status-only update (e.g. closing a job out as COMPLETED) must keep
  // working even if the Customer/Vehicle/Service it references has since
  // been deactivated — deactivation never blocks managing history that
  // already exists, only *new or changed* references need to be active.
  if (relationsChanged) {
    await assertEntitiesActiveAndOwned(ctx, {
      customerId: effectiveCustomerId,
      vehicleId: effectiveVehicleId,
      serviceId: effectiveServiceId,
    })
  }

  if (timeChanged) {
    assertDuration(effectiveStartAt, effectiveEndAt)
    await assertWithinWorkingHours(ctx, effectiveStartAt, effectiveEndAt)
  }

  const write = async (db?: DbClient) => {
    const updated = await appointmentRepository.updateById(ctx.tenant.id, ctx.business.id, id, input, db)
    if (!updated) {
      throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
    }
    return updated
  }

  // Status-only / notes-only edits never touch scheduling — no lock, no
  // capacity check (a legacy over-booked slot still lets you confirm,
  // start or close its appointments).
  if (!relationsChanged && !timeChanged) {
    return write()
  }

  // Capacity only matters when the interval moves (reschedule, new end =
  // new duration) and the appointment will still hold a post afterwards —
  // moving and cancelling in one PATCH frees a post, it never takes one.
  // A vehicle/customer/service change on the same interval takes no extra
  // post. The appointment itself is excluded from its own count.
  const effectiveStatus = input.status ?? existing.status
  const check = {
    vehicleId: effectiveVehicleId,
    startAt: effectiveStartAt,
    endAt: effectiveEndAt,
    excludeId: id,
    checkCapacity: timeChanged && consumesCapacity(effectiveStatus),
  }
  return withSchedulingLock(ctx, check, (tx) => write(tx))
}

// --- Availability (Prompt 10) --------------------------------------------
//
// Real, computed availability — the AI Booking Tool Layer's
// check_availability tool calls this directly rather than duplicating any
// working-hours/timezone/conflict logic of its own. This function contains
// no AI-specific code at all; it's a plain extension of the existing
// Appointment domain, reusable by any future caller (a booking widget,
// etc.) exactly the way createAppointment/updateAppointment already are.

/** Booking granularity — no project convention exists yet, so this uses the value the spec calls out as the default. */
const SLOT_GRANULARITY_MINUTES = 30

export interface AvailabilitySlot {
  startAt: Date
  endAt: Date
  /** "HH:mm" in Business.timezone — the wall-clock time a human actually reads. */
  localStart: string
  localEnd: string
}

export interface CheckAvailabilityInput {
  serviceId: string
  /** Calendar date in Business.timezone, "YYYY-MM-DD" — never a UTC timestamp (spec §"DATE HANDLING"). */
  date: string
  customerId?: string | null
  vehicleId?: string | null
  preferredTimeFrom?: string | null
  preferredTimeTo?: string | null
  /**
   * Prompt 51 — the appointment being rescheduled: it never blocks its own
   * new slot (neither its post nor its vehicle). Must belong to the
   * current tenant + business (404 otherwise).
   */
  excludeAppointmentId?: string | null
}

export interface AvailabilityResult {
  date: string
  timezone: string
  slots: AvailabilitySlot[]
}

function timeKeyToMinutes(timeKey: string): number {
  const [h, m] = timeKey.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function minutesToTimeKey(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Computes real, currently-open, non-conflicting slots for one service on
 * one calendar date — never invented, never approximate. Reuses:
 *  - BusinessWorkingHours (Prompt 02) for open/closed days and hours —
 *    no second schedule model, exactly like createAppointment.
 *  - businessLocalToUtc / toBusinessLocalDateTime (src/server/lib/
 *    timezone.ts) for every local<->UTC conversion — DST-safe, no manual
 *    offset arithmetic.
 *  - appointmentRepository.findConflict — the exact same per-vehicle
 *    interval-overlap check createAppointment/updateAppointment already
 *    use, applied once per candidate slot.
 *
 *  - Prompt 50: business capacity (serviceBayCapacity) — a slot with no free
 *    post is never offered, computed by the same domain/capacity.ts math
 *    createAppointment enforces, from ONE bounded query for the whole open
 *    window of the day (no per-slot query).
 *
 * customerId/vehicleId are optional (spec): if given, they're verified to
 * exist/belong-to-tenant/belong-to-each-other (404/400, same convention as
 * elsewhere); vehicleId additionally filters out that vehicle's own
 * conflicts. Unlike createAppointment, the vehicle is NOT required to
 * be active here — offering slots is informational; the existing active
 * check still applies, unavoidably, at actual creation time.
 */
export async function checkAvailability(ctx: AuthContext, input: CheckAvailabilityInput): Promise<AvailabilityResult> {
  const timezone = ctx.business.timezone

  const service = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, input.serviceId)
  if (!service) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
  if (!service.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Service is not active')
  }

  if (input.customerId) {
    const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, input.customerId)
    if (!customer) {
      throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
    }
  }

  if (input.vehicleId) {
    const vehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, input.vehicleId)
    if (!vehicle) {
      throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
    }
    if (input.customerId && vehicle.customerId !== input.customerId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Vehicle does not belong to the specified customer')
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid date — expected YYYY-MM-DD')
  }

  const excludeId = await resolveExcludedAppointment(ctx, input.excludeAppointmentId)

  // Local noon safely identifies the weekday for this calendar date
  // regardless of DST — unlike midnight, noon is never ambiguous or
  // skipped by a DST transition.
  const referenceInstant = businessLocalToUtc(input.date, '12:00', timezone)
  const { dayOfWeek } = toBusinessLocalDateTime(referenceInstant, timezone)

  const days = await workingHoursRepository.listByBusiness(ctx.business.id)
  const day = days.find((d) => d.dayOfWeek === dayOfWeek)

  // Closed day: no availability, not an error — the caller (e.g. the AI
  // Booking tool) decides how to phrase that to the customer.
  if (!day || !day.isOpen || !day.openTime || !day.closeTime) {
    return { date: input.date, timezone, slots: [] }
  }

  const duration = service.durationMinutes
  const openMinutes = timeKeyToMinutes(day.openTime)
  const closeMinutes = timeKeyToMinutes(day.closeTime)
  const now = Date.now()

  // Every candidate slot lies inside [open, close) of this local day, so
  // one query over that window returns every appointment that can take a
  // post during any of them.
  const dayOccupants = await appointmentRepository.listCapacityOccupants(
    ctx.tenant.id,
    ctx.business.id,
    businessLocalToUtc(input.date, day.openTime, timezone),
    businessLocalToUtc(input.date, day.closeTime, timezone),
    excludeId
  )

  const candidates: AvailabilitySlot[] = []
  for (let start = openMinutes; start + duration <= closeMinutes; start += SLOT_GRANULARITY_MINUTES) {
    const localStart = minutesToTimeKey(start)
    const localEnd = minutesToTimeKey(start + duration)

    if (input.preferredTimeFrom && localStart < input.preferredTimeFrom) continue
    if (input.preferredTimeTo && localEnd > input.preferredTimeTo) continue

    const startAt = businessLocalToUtc(input.date, localStart, timezone)
    const endAt = businessLocalToUtc(input.date, localEnd, timezone)

    // Never offer a slot that has already started — a requested date
    // entirely in the past naturally yields zero slots this same way,
    // with no separate "is this date in the past" special case needed.
    if (startAt.getTime() <= now) continue

    if (!capacitySnapshot(ctx.business.serviceBayCapacity, dayOccupants, startAt, endAt).available) continue

    candidates.push({ startAt, endAt, localStart, localEnd })
  }

  // The vehicle check is the same per-slot findConflict as before, now run
  // side by side (Prompt 51 — the booking form asks on every date change)
  // instead of one round-trip after another. Order is preserved.
  const vehicleId = input.vehicleId
  if (!vehicleId) {
    return { date: input.date, timezone, slots: candidates }
  }
  const conflicts = await Promise.all(
    candidates.map((slot) => appointmentRepository.findConflict(ctx.tenant.id, ctx.business.id, vehicleId, slot.startAt, slot.endAt, excludeId))
  )
  return { date: input.date, timezone, slots: candidates.filter((_, i) => !conflicts[i]) }
}

/**
 * Prompt 51 — validates an excludeAppointmentId (reschedule: "don't count
 * the appointment I'm moving") against the current tenant + business. A
 * foreign or unknown id is 404, never silently ignored, so it can't be used
 * to probe other tenants; a valid one only ever removes that single
 * appointment from the count. The final update still runs every check
 * under the scheduling lock.
 */
async function resolveExcludedAppointment(ctx: AuthContext, id: string | null | undefined): Promise<string | undefined> {
  if (!id) return undefined
  const appointment = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!appointment) {
    throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
  }
  return appointment.id
}

// --- Interval availability (Prompt 50) --------------------------------------
//
// "Can this business take this vehicle/service at exactly this time?" —
// the foundation behind GET /api/appointments/availability. Runs the SAME
// rules createAppointment runs (working hours, vehicle conflict, capacity),
// read-only and without the lock, and reports every rule that fails instead
// of stopping at the first one. It deliberately adds no rule of its own
// (e.g. no "in the past" check — createAppointment has none), so its answer
// always matches what a create at that moment would do. The locked
// re-check inside createAppointment stays the final word under concurrency.

export type IntervalUnavailableReason = 'OUTSIDE_WORKING_HOURS' | 'VEHICLE_CONFLICT' | 'CAPACITY_EXCEEDED'

const UNAVAILABLE_REASON_MESSAGES: Record<IntervalUnavailableReason, string> = {
  OUTSIDE_WORKING_HOURS: 'Выбранное время вне рабочих часов автосервиса.',
  VEHICLE_CONFLICT: 'У этого автомобиля уже есть запись на это время.',
  CAPACITY_EXCEEDED: CAPACITY_EXCEEDED_MESSAGE,
}

export interface IntervalAvailabilityInput {
  serviceId: string
  startAt: Date
  /** Optional explicit end; otherwise startAt + Service.durationMinutes (same as the slot generator). */
  endAt?: Date | null
  vehicleId?: string | null
  /** The appointment being rescheduled — never counted against itself. */
  excludeAppointmentId?: string | null
}

export interface IntervalAvailabilityResult {
  startAt: Date
  endAt: Date
  timezone: string
  available: boolean
  reasons: { code: IntervalUnavailableReason; message: string }[]
  capacity: CapacitySnapshot
}

export async function checkIntervalAvailability(ctx: AuthContext, input: IntervalAvailabilityInput): Promise<IntervalAvailabilityResult> {
  const service = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, input.serviceId)
  if (!service) {
    throw new ApiError(404, 'NOT_FOUND', 'Service not found')
  }
  if (!service.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Service is not active')
  }
  if (input.vehicleId) {
    const vehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, input.vehicleId)
    if (!vehicle) {
      throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
    }
  }

  const startAt = input.startAt
  const endAt = input.endAt ?? new Date(startAt.getTime() + service.durationMinutes * 60_000)
  assertDuration(startAt, endAt)

  const reasons: IntervalUnavailableReason[] = []
  try {
    await assertWithinWorkingHours(ctx, startAt, endAt)
  } catch (err) {
    if (!(err instanceof ApiError) || err.statusCode !== 400) throw err
    reasons.push('OUTSIDE_WORKING_HOURS')
  }

  const excludeId = await resolveExcludedAppointment(ctx, input.excludeAppointmentId)
  if (input.vehicleId) {
    const conflict = await appointmentRepository.findConflict(ctx.tenant.id, ctx.business.id, input.vehicleId, startAt, endAt, excludeId)
    if (conflict) reasons.push('VEHICLE_CONFLICT')
  }

  const capacity = await getIntervalCapacity(ctx, startAt, endAt, excludeId)
  if (!capacity.available) reasons.push('CAPACITY_EXCEEDED')

  return {
    startAt,
    endAt,
    timezone: ctx.business.timezone,
    available: reasons.length === 0,
    reasons: reasons.map((code) => ({ code, message: UNAVAILABLE_REASON_MESSAGES[code] })),
    capacity,
  }
}
