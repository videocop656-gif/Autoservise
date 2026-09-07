import type { LeadSource, LeadStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { leadRepository } from '../repositories/leadRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { serviceRepository } from '../repositories/serviceRepository'
import type { CreateLeadInput, UpdateLeadInput } from '../validation/lead.schemas'
import type { PaginationParams } from '../lib/pagination'

interface LeadRelationRefs {
  customerId: string
  vehicleId: string | null
  serviceId: string | null
}

/**
 * Re-validates that customer/vehicle/service all belong to the current
 * tenant+business, and that the vehicle (if any) belongs to the given
 * customer. Used by both create and update — update calls it with the
 * *effective* (merged) references, since a PATCH may only change one of
 * the three fields while leaving the others as they already were.
 *
 * `requireActiveCustomer` is only set by createLead: a *new* Lead can't be
 * opened against a deactivated Customer. It's deliberately NOT enforced on
 * update — deactivating a Customer must never block staff from continuing
 * to manage (e.g. closing out as LOST) Leads that already reference them.
 */
async function assertLeadRelations(
  ctx: AuthContext,
  refs: LeadRelationRefs,
  options: { requireActiveCustomer?: boolean } = {}
): Promise<void> {
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, refs.customerId)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  if (options.requireActiveCustomer && !customer.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot create a lead for an inactive customer')
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
  }
}

export async function listLeads(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: LeadStatus
    source?: LeadSource
    customerId?: string
    vehicleId?: string
    serviceId?: string
    search?: string
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return leadRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getLead(ctx: AuthContext, id: string) {
  const lead = await leadRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!lead) {
    throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  }
  return lead
}

export async function createLead(ctx: AuthContext, input: CreateLeadInput) {
  requireRole(ctx, 'owner', 'admin')

  const vehicleId = input.vehicleId ?? null
  const serviceId = input.serviceId ?? null
  await assertLeadRelations(ctx, { customerId: input.customerId, vehicleId, serviceId }, { requireActiveCustomer: true })

  return leadRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    customerId: input.customerId,
    vehicleId,
    serviceId,
    status: input.status ?? 'NEW',
    source: input.source ?? 'MANUAL',
    subject: input.subject,
    description: input.description ?? null,
    notes: input.notes ?? null,
  })
}

export async function updateLead(ctx: AuthContext, id: string, input: UpdateLeadInput) {
  requireRole(ctx, 'owner', 'admin')

  const existing = await leadRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  }

  const effectiveCustomerId = input.customerId ?? existing.customerId
  const effectiveVehicleId = input.vehicleId !== undefined ? input.vehicleId : existing.vehicleId
  const effectiveServiceId = input.serviceId !== undefined ? input.serviceId : existing.serviceId

  await assertLeadRelations(ctx, {
    customerId: effectiveCustomerId,
    vehicleId: effectiveVehicleId,
    serviceId: effectiveServiceId,
  })

  const updated = await leadRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
  }
  return updated
}
