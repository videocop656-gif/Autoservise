import type { AppointmentStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { toBusinessLocalDateTime } from '../lib/timezone'
import { appointmentRepository } from '../repositories/appointmentRepository'
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
  excludeId?: string
): Promise<void> {
  const conflict = await appointmentRepository.findConflict(ctx.tenant.id, ctx.business.id, vehicleId, startAt, endAt, excludeId)
  if (conflict) {
    throw new ApiError(409, 'APPOINTMENT_CONFLICT', 'This vehicle already has a conflicting appointment', {
      conflictingAppointmentId: conflict.id,
    })
  }
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
export async function createAppointment(ctx: AuthContext, input: CreateAppointmentInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const refs = { customerId: input.customerId, vehicleId: input.vehicleId, serviceId: input.serviceId }
  await assertEntitiesActiveAndOwned(ctx, refs)
  assertDuration(input.startAt, input.endAt)
  await assertWithinWorkingHours(ctx, input.startAt, input.endAt)
  await assertNoConflict(ctx, input.vehicleId, input.startAt, input.endAt)

  return appointmentRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: input.serviceId,
    startAt: input.startAt,
    endAt: input.endAt,
    status: input.status ?? 'SCHEDULED',
    notes: input.notes ?? null,
  })
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

  if (relationsChanged || timeChanged) {
    await assertNoConflict(ctx, effectiveVehicleId, effectiveStartAt, effectiveEndAt, id)
  }

  const updated = await appointmentRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
  }
  return updated
}
