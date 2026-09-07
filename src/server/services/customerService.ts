import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import type { CreateCustomerInput, UpdateCustomerInput } from '../validation/customer.schemas'
import type { PaginationParams } from '../lib/pagination'

export async function listCustomers(ctx: AuthContext, opts: PaginationParams & { activeOnly: boolean; search?: string }) {
  const skip = (opts.page - 1) * opts.pageSize
  return customerRepository.list(ctx.tenant.id, ctx.business.id, {
    activeOnly: opts.activeOnly,
    search: opts.search,
    skip,
    take: opts.pageSize,
  })
}

export async function getCustomer(ctx: AuthContext, id: string) {
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  return customer
}

/** Optionally attaches the customer's active vehicles — never on by default, so a plain GET stays a single-row fetch. */
export async function getCustomerDetail(ctx: AuthContext, id: string, includeVehicles: boolean) {
  const customer = await getCustomer(ctx, id)
  if (!includeVehicles) {
    return { customer, vehicles: undefined }
  }
  const { items } = await vehicleRepository.list(ctx.tenant.id, ctx.business.id, {
    activeOnly: true,
    customerId: id,
    skip: 0,
    take: 100,
  })
  return { customer, vehicles: items }
}

async function assertNoActiveEmailDuplicate(ctx: AuthContext, email: string, excludeId?: string): Promise<void> {
  const existing = await customerRepository.findActiveByEmail(ctx.tenant.id, ctx.business.id, email, excludeId)
  if (existing) {
    throw new ApiError(409, 'CUSTOMER_EMAIL_EXISTS', 'An active customer with this email already exists')
  }
}

export async function createCustomer(ctx: AuthContext, input: CreateCustomerInput) {
  requireRole(ctx, 'owner', 'admin')

  if (input.email) {
    await assertNoActiveEmailDuplicate(ctx, input.email)
  }

  return customerRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    firstName: input.firstName,
    lastName: input.lastName ?? null,
    phone: input.phone,
    email: input.email ?? null,
    notes: input.notes ?? null,
  })
}

export async function updateCustomer(ctx: AuthContext, id: string, input: UpdateCustomerInput) {
  requireRole(ctx, 'owner', 'admin')

  if (input.email) {
    await assertNoActiveEmailDuplicate(ctx, input.email, id)
  }

  const updated = await customerRepository.updateById(ctx.tenant.id, ctx.business.id, id, input)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
  return updated
}

/** Idempotent: deactivating an already-inactive customer still succeeds. */
export async function deactivateCustomer(ctx: AuthContext, id: string): Promise<void> {
  requireRole(ctx, 'owner', 'admin')
  const count = await customerRepository.deactivate(ctx.tenant.id, ctx.business.id, id)
  if (count === 0) {
    throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
  }
}
