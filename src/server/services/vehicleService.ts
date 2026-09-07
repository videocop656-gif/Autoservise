import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { customerRepository } from '../repositories/customerRepository'
import type { CreateVehicleInput, UpdateVehicleInput } from '../validation/vehicle.schemas'
import type { PaginationParams } from '../lib/pagination'

export async function listVehicles(
  ctx: AuthContext,
  opts: PaginationParams & { activeOnly: boolean; search?: string; customerId?: string }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return vehicleRepository.list(ctx.tenant.id, ctx.business.id, {
    activeOnly: opts.activeOnly,
    search: opts.search,
    customerId: opts.customerId,
    skip,
    take: opts.pageSize,
  })
}

export async function getVehicle(ctx: AuthContext, id: string) {
  const vehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!vehicle) {
    throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
  }
  return vehicle
}

export async function createVehicle(ctx: AuthContext, input: CreateVehicleInput) {
  requireRole(ctx, 'owner', 'admin')

  // The customer must belong to this tenant/business — never trust
  // customerId from the client without this check.
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, input.customerId)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }

  return vehicleRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    customerId: input.customerId,
    make: input.make,
    model: input.model,
    year: input.year ?? null,
    licensePlate: input.licensePlate ?? null,
    vin: input.vin ?? null,
    mileage: input.mileage ?? null,
    notes: input.notes ?? null,
  })
}

export async function updateVehicle(ctx: AuthContext, id: string, input: UpdateVehicleInput) {
  requireRole(ctx, 'owner', 'admin')
  const updated = await vehicleRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
  }
  return updated
}

/** Idempotent: deactivating an already-inactive vehicle still succeeds. */
export async function deactivateVehicle(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, 'owner', 'admin')
  const count = await vehicleRepository.deactivate(ctx.tenant.id, ctx.business.id, id)
  if (count === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
  }
}
