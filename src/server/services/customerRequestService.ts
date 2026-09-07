import type { CustomerRequestSource, CustomerRequestStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { toBusinessLocalDateTime } from '../lib/timezone'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { appointmentRepository } from '../repositories/appointmentRepository'
import type { CreateCustomerRequestInput, UpdateCustomerRequestInput } from '../validation/customerRequest.schemas'
import type { PaginationParams } from '../lib/pagination'

// Deliberate, explicit allow-list — same style as Appointment's
// ALLOWED_TRANSITIONS. CONVERTED/CLOSED/CANCELLED are terminal: once
// reached, a request never resumes (spec §15).
//
// The spec's flow diagram visually ends with an arrow into CLOSED right
// after CONVERTED, but its own explicit rule list says "CONVERTED —
// terminal" with no qualification, and a terminal state that still allows
// one specific outgoing transition isn't terminal. The explicit textual
// rule is treated as authoritative: CONVERTED has no outgoing transitions
// at all. (Flagged in the Prompt 07 final report as an ambiguity resolved
// this way.)
const ALLOWED_TRANSITIONS: Record<CustomerRequestStatus, CustomerRequestStatus[]> = {
  NEW: ['IN_PROGRESS', 'CLOSED', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'QUALIFIED', 'CLOSED', 'CANCELLED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'CLOSED', 'CANCELLED'],
  QUALIFIED: ['CONVERTED', 'CLOSED', 'CANCELLED'],
  CONVERTED: [],
  CLOSED: [],
  CANCELLED: [],
}

function assertValidTransition(from: CustomerRequestStatus, to: CustomerRequestStatus): void {
  if (from === to) return
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot change customer request status from ${from} to ${to}`)
  }
}

function assertTimeRangeValid(from: string | null, to: string | null): void {
  if (from && to && from >= to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'requestedTimeFrom must be before requestedTimeTo')
  }
}

/**
 * Normalizes a raw ISO 8601 instant to the Business-local calendar date it
 * falls on, stored as UTC midnight of that date. requestedDate is a wanted
 * *day*, never a specific moment (spec §11) — never Appointment.startAt —
 * so only the date portion, read in Business.timezone (the app's sole
 * timezone source, see src/server/lib/timezone.ts), survives.
 */
function normalizeRequestedDate(raw: string | null | undefined, timezone: string): Date | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const { dateKey } = toBusinessLocalDateTime(new Date(raw), timezone)
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

interface RelationRefs {
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  appointmentId: string | null
}

/**
 * Verifies customer/vehicle/service/appointment all belong to the current
 * tenant+business and are internally consistent with each other.
 *
 * Unlike Appointment/ServiceRecord, a CustomerRequest's Vehicle is NOT
 * required to be active — it's just an inquiry, which can legitimately be
 * about a vehicle no longer in active use (spec §7 only requires
 * ownership/consistency for vehicleId, no active-state rule). Service, like
 * everywhere else it's referenced, must be active whenever it's part of
 * what's being validated (spec §7).
 *
 * `requireActiveCustomer` mirrors leadService's exact convention: only
 * enforced by createCustomerRequest, never by updateCustomerRequest (even
 * when customerId itself changes) — deactivating a Customer must never
 * block staff from continuing to manage requests that already reference
 * them (spec §13-14).
 */
async function assertRelations(
  ctx: AuthContext,
  refs: RelationRefs,
  options: { requireActiveCustomer?: boolean } = {}
): Promise<void> {
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, refs.customerId)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  if (options.requireActiveCustomer && !customer.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot create a customer request for an inactive customer')
  }

  if (refs.vehicleId) {
    const vehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, refs.vehicleId)
    if (!vehicle) {
      throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
    }
    if (vehicle.customerId !== refs.customerId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Vehicle does not belong to the specified customer')
    }
  }

  if (refs.serviceId) {
    const service = await serviceRepository.findById(ctx.tenant.id, ctx.business.id, refs.serviceId)
    if (!service) {
      throw new ApiError(404, 'NOT_FOUND', 'Service not found')
    }
    if (!service.isActive) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Service is not active')
    }
  }

  if (refs.appointmentId) {
    const appointment = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, refs.appointmentId)
    if (!appointment) {
      throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
    }
    if (appointment.customerId !== refs.customerId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment belongs to a different customer')
    }
    if (refs.vehicleId && appointment.vehicleId !== refs.vehicleId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment is for a different vehicle')
    }
    if (refs.serviceId && appointment.serviceId !== refs.serviceId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment is for a different service')
    }
  }
}

export async function listCustomerRequests(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: CustomerRequestStatus
    source?: CustomerRequestSource
    customerId?: string
    vehicleId?: string
    serviceId?: string
    appointmentId?: string
    search?: string
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return customerRequestRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getCustomerRequest(ctx: AuthContext, id: string) {
  const request = await customerRequestRepository.findByIdWithHistory(ctx.tenant.id, ctx.business.id, id)
  if (!request) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
  }
  return request
}

// CustomerRequest is operational, the same exception already established
// for Appointment/ServiceRecord: manager gets full read/write/status-change
// access, not read-only like the Settings-style entities.
export async function createCustomerRequest(ctx: AuthContext, input: CreateCustomerRequestInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const vehicleId = input.vehicleId ?? null
  const serviceId = input.serviceId ?? null
  const appointmentId = input.appointmentId ?? null
  const requestedTimeFrom = input.requestedTimeFrom ?? null
  const requestedTimeTo = input.requestedTimeTo ?? null

  await assertRelations(ctx, { customerId: input.customerId, vehicleId, serviceId, appointmentId }, { requireActiveCustomer: true })
  assertTimeRangeValid(requestedTimeFrom, requestedTimeTo)

  const requestedDate = normalizeRequestedDate(input.requestedDate, ctx.business.timezone) ?? null

  // CREATE always starts at NEW, whether or not an appointmentId was given
  // (spec §17's own recommended simplification — no hidden automatic
  // transitions; moving to QUALIFIED/CONVERTED is always a later, explicit PATCH).
  return customerRequestRepository.createWithInitialHistory(
    {
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      customerId: input.customerId,
      vehicleId,
      serviceId,
      appointmentId,
      source: input.source ?? 'MANUAL',
      status: 'NEW',
      subject: input.subject,
      description: input.description ?? null,
      requestedDate,
      requestedTimeFrom,
      requestedTimeTo,
      notes: input.notes ?? null,
    },
    ctx.user.id
  )
}

export async function updateCustomerRequest(ctx: AuthContext, id: string, input: UpdateCustomerRequestInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const existing = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
  }

  const effectiveCustomerId = input.customerId ?? existing.customerId
  const effectiveVehicleId = input.vehicleId !== undefined ? input.vehicleId : existing.vehicleId
  const effectiveServiceId = input.serviceId !== undefined ? input.serviceId : existing.serviceId
  const effectiveAppointmentId = input.appointmentId !== undefined ? input.appointmentId : existing.appointmentId
  const effectiveTimeFrom = input.requestedTimeFrom !== undefined ? input.requestedTimeFrom : existing.requestedTimeFrom
  const effectiveTimeTo = input.requestedTimeTo !== undefined ? input.requestedTimeTo : existing.requestedTimeTo

  const relationsChanged =
    input.customerId !== undefined ||
    input.vehicleId !== undefined ||
    input.serviceId !== undefined ||
    input.appointmentId !== undefined
  const timeRangeChanged = input.requestedTimeFrom !== undefined || input.requestedTimeTo !== undefined

  // A CONVERTED request can never have its appointment link removed — even
  // by an update that isn't otherwise touching status (spec §16).
  if (existing.status === 'CONVERTED' && input.appointmentId === null) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot remove the appointment link from a converted customer request')
  }

  if (input.status !== undefined) {
    assertValidTransition(existing.status, input.status)
    if (input.status === 'CONVERTED' && !effectiveAppointmentId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot mark a customer request as CONVERTED without a linked appointment')
    }
  }

  // Only re-validate what's actually changing — deactivating a Customer/
  // Service (or an Appointment referenced elsewhere) must never block
  // editing/status-changing a request that already references them (spec §14).
  if (relationsChanged) {
    await assertRelations(ctx, {
      customerId: effectiveCustomerId,
      vehicleId: effectiveVehicleId,
      serviceId: effectiveServiceId,
      appointmentId: effectiveAppointmentId,
    })
  }

  if (timeRangeChanged) {
    assertTimeRangeValid(effectiveTimeFrom, effectiveTimeTo)
  }

  const { requestedDate: rawRequestedDate, ...restInput } = input
  const normalizedDate = normalizeRequestedDate(rawRequestedDate, ctx.business.timezone)
  const data = {
    ...restInput,
    ...(normalizedDate !== undefined ? { requestedDate: normalizedDate } : {}),
  }

  let updated
  if (input.status !== undefined && input.status !== existing.status) {
    updated = await customerRequestRepository.updateWithStatusHistory(ctx.tenant.id, ctx.business.id, id, data, {
      fromStatus: existing.status,
      toStatus: input.status,
      changedByUserId: ctx.user.id,
    })
  } else {
    updated = await customerRequestRepository.updateById(ctx.tenant.id, ctx.business.id, id, data)
  }

  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
  }
  return updated
}
