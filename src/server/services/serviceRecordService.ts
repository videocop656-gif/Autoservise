import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { serviceRecordRepository } from '../repositories/serviceRecordRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import { appointmentRepository } from '../repositories/appointmentRepository'
import type { CreateServiceRecordInput, UpdateServiceRecordInput } from '../validation/serviceRecord.schemas'
import type { PaginationParams } from '../lib/pagination'

interface RelationRefs {
  customerId: string
  vehicleId: string
  serviceId: string
}

/**
 * Verifies customer/vehicle/service all belong to the current tenant+
 * business, that the vehicle belongs to the given customer, and that all
 * three are currently active — same shape as Appointment's equivalent
 * check (Prompt 05), reused conceptually rather than literally shared,
 * since each service module keeps its own copy (matching the project's
 * existing convention — see leadService/appointmentService).
 */
async function assertRelationsOwnedAndActive(ctx: AuthContext, refs: RelationRefs): Promise<void> {
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

interface AppointmentRefs {
  appointmentId: string
  customerId: string
  vehicleId: string
  serviceId: string
}

/** If an Appointment is linked, it must belong to this tenant/business and reference the exact same customer/vehicle/service. */
async function assertAppointmentConsistency(ctx: AuthContext, refs: AppointmentRefs): Promise<void> {
  const appointment = await appointmentRepository.findById(ctx.tenant.id, ctx.business.id, refs.appointmentId)
  if (!appointment) {
    throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
  }
  if (appointment.customerId !== refs.customerId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment belongs to a different customer')
  }
  if (appointment.vehicleId !== refs.vehicleId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment is for a different vehicle')
  }
  if (appointment.serviceId !== refs.serviceId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Appointment is for a different service')
  }
}

/**
 * Enforces that mileage never decreases across a vehicle's non-archived
 * history. Callers only invoke this when the record being saved will end
 * up non-archived with a non-null mileage — archiving, restoring-to-
 * archived, or clearing mileage never trigger it.
 */
async function assertMileageIsNotDecreasing(
  ctx: AuthContext,
  vehicleId: string,
  mileage: number,
  excludeId?: string
): Promise<void> {
  const max = await serviceRecordRepository.findMaxActiveMileage(ctx.tenant.id, ctx.business.id, vehicleId, excludeId)
  if (max !== null && mileage < max) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Mileage cannot be lower than this vehicle's latest recorded mileage (${max} km)`)
  }
}

export async function listServiceRecords(
  ctx: AuthContext,
  opts: PaginationParams & {
    customerId?: string
    vehicleId?: string
    serviceId?: string
    dateFrom?: Date
    dateTo?: Date
    includeArchived: boolean
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return serviceRecordRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getServiceRecord(ctx: AuthContext, id: string) {
  const record = await serviceRecordRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!record) {
    throw new ApiError(404, 'NOT_FOUND', 'Service record not found')
  }
  return record
}

// Owner/admin/manager can all create/update — Service History is
// operational record-keeping, same exception as Appointment (Prompt 05),
// not a Settings-style entity where manager is read-only.
export async function createServiceRecord(ctx: AuthContext, input: CreateServiceRecordInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const refs = { customerId: input.customerId, vehicleId: input.vehicleId, serviceId: input.serviceId }
  await assertRelationsOwnedAndActive(ctx, refs)

  const appointmentId = input.appointmentId ?? null
  if (appointmentId) {
    await assertAppointmentConsistency(ctx, { appointmentId, ...refs })
  }

  if (input.mileage != null) {
    await assertMileageIsNotDecreasing(ctx, input.vehicleId, input.mileage)
  }

  return serviceRecordRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    customerId: input.customerId,
    vehicleId: input.vehicleId,
    serviceId: input.serviceId,
    appointmentId,
    performedAt: input.performedAt,
    mileage: input.mileage ?? null,
    totalPrice: input.totalPrice,
    currency: input.currency ?? ctx.business.currency,
    workDescription: input.workDescription,
    partsDescription: input.partsDescription ?? null,
    recommendations: input.recommendations ?? null,
    notes: input.notes ?? null,
  })
}

export async function updateServiceRecord(ctx: AuthContext, id: string, input: UpdateServiceRecordInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const existing = await serviceRecordRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Service record not found')
  }

  const effectiveCustomerId = input.customerId ?? existing.customerId
  const effectiveVehicleId = input.vehicleId ?? existing.vehicleId
  const effectiveServiceId = input.serviceId ?? existing.serviceId
  const effectiveAppointmentId = input.appointmentId !== undefined ? input.appointmentId : existing.appointmentId
  const effectiveMileage = input.mileage !== undefined ? input.mileage : existing.mileage
  const effectiveIsArchived = input.isArchived !== undefined ? input.isArchived : existing.isArchived

  const relationsChanged =
    input.customerId !== undefined ||
    input.vehicleId !== undefined ||
    input.serviceId !== undefined ||
    input.appointmentId !== undefined

  // Only re-validate ownership/active-state for relations actually being
  // changed — a plain edit (or archive/restore) of an existing record must
  // never be blocked by its Customer/Vehicle/Service having since been
  // deactivated. This preserves history exactly like Appointment (§8).
  if (relationsChanged) {
    const refs = { customerId: effectiveCustomerId, vehicleId: effectiveVehicleId, serviceId: effectiveServiceId }
    await assertRelationsOwnedAndActive(ctx, refs)
    if (effectiveAppointmentId) {
      await assertAppointmentConsistency(ctx, { appointmentId: effectiveAppointmentId, ...refs })
    }
  }

  // Mileage validation applies whenever the record will end up non-archived
  // with a mileage value — this covers create, plain updates, and restore
  // (isArchived: false) alike, but never archiving itself (§11, §14).
  if (!effectiveIsArchived && effectiveMileage != null) {
    await assertMileageIsNotDecreasing(ctx, effectiveVehicleId, effectiveMileage, id)
  }

  const updated = await serviceRecordRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Service record not found')
  }
  return updated
}
