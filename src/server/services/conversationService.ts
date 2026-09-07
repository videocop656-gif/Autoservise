import type { ConversationChannel, ConversationStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { customerRepository } from '../repositories/customerRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import type { CreateConversationInput, UpdateConversationInput } from '../validation/conversation.schemas'
import type { PaginationParams } from '../lib/pagination'

interface RelationRefs {
  customerId: string | null
  customerRequestId: string | null
}

/**
 * Verifies customer/customerRequest both belong to the current
 * tenant+business (404 if foreign-tenant), and — when both are present —
 * that they're mutually consistent: CustomerRequest.customerId must equal
 * the Conversation's own customerId (spec §6). Neither relation requires
 * an "active" customer — a Conversation can legitimately be the very first
 * contact from someone not yet identified as a customer at all (spec §5),
 * so there is no analogous "requireActiveCustomer" flag here unlike
 * Lead/CustomerRequest's create-only rule.
 */
async function assertRelations(ctx: AuthContext, refs: RelationRefs): Promise<void> {
  if (refs.customerId) {
    const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, refs.customerId)
    if (!customer) {
      throw new ApiError(404, 'NOT_FOUND', 'Customer not found')
    }
  }

  if (refs.customerRequestId) {
    const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, refs.customerRequestId)
    if (!request) {
      throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
    }
    if (refs.customerId && request.customerId !== refs.customerId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Customer request belongs to a different customer')
    }
  }
}

/**
 * Applies the OPEN/CLOSED lifecycle rules (spec §20) to a PATCH payload,
 * deliberately as a tiny pure function rather than a generic state
 * machine — there are only two statuses and no history is kept for them
 * (that's CustomerRequestStatusHistory's job, not this).
 *
 *  - OPEN -> CLOSED: closedAt = the given value, or now() if omitted.
 *  - CLOSED -> OPEN: closedAt is always forced back to null, regardless of
 *    what the client sent — a re-opened conversation is not closed.
 *  - OPEN -> OPEN / CLOSED -> CLOSED (no-op transitions) and a bare
 *    closedAt-only PATCH (no status field at all): closedAt is applied
 *    exactly as given, if given at all — it's an independently patchable
 *    field (spec §19).
 */
function computeStatusFields(
  existingStatus: ConversationStatus,
  input: { status?: ConversationStatus; closedAt?: Date | null }
): { status?: ConversationStatus; closedAt?: Date | null } {
  if (input.status === undefined) {
    return input.closedAt !== undefined ? { closedAt: input.closedAt } : {}
  }

  if (input.status === 'CLOSED' && existingStatus !== 'CLOSED') {
    return { status: 'CLOSED', closedAt: input.closedAt !== undefined ? input.closedAt : new Date() }
  }
  if (input.status === 'OPEN' && existingStatus !== 'OPEN') {
    return { status: 'OPEN', closedAt: null }
  }
  // no-op transition (status unchanged)
  return { status: input.status, ...(input.closedAt !== undefined ? { closedAt: input.closedAt } : {}) }
}

export async function listConversations(
  ctx: AuthContext,
  opts: PaginationParams & {
    status?: ConversationStatus
    channel?: ConversationChannel
    customerId?: string
    customerRequestId?: string
    search?: string
  }
) {
  const skip = (opts.page - 1) * opts.pageSize
  return conversationRepository.list(ctx.tenant.id, ctx.business.id, { ...opts, skip, take: opts.pageSize })
}

export async function getConversation(ctx: AuthContext, id: string) {
  const conversation = await conversationRepository.findByIdWithDetail(ctx.tenant.id, ctx.business.id, id)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }
  return conversation
}

// Conversation is operational, the same exception already established for
// Appointment/ServiceRecord/CustomerRequest: manager gets full read/write
// access, not read-only like the Settings-style entities.
export async function createConversation(ctx: AuthContext, input: CreateConversationInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const customerId = input.customerId ?? null
  const customerRequestId = input.customerRequestId ?? null
  await assertRelations(ctx, { customerId, customerRequestId })

  return conversationRepository.create({
    tenantId: ctx.tenant.id,
    businessId: ctx.business.id,
    customerId,
    customerRequestId,
    channel: input.channel,
    status: 'OPEN',
    subject: input.subject ?? null,
    startedAt: input.startedAt ?? new Date(),
  })
}

export async function updateConversation(ctx: AuthContext, id: string, input: UpdateConversationInput) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const existing = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!existing) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }

  const effectiveCustomerId = input.customerId !== undefined ? input.customerId : existing.customerId
  const effectiveCustomerRequestId = input.customerRequestId !== undefined ? input.customerRequestId : existing.customerRequestId
  const relationsChanged = input.customerId !== undefined || input.customerRequestId !== undefined

  // Only re-validate what's actually changing — a plain subject edit, or a
  // status change, is never blocked by a relation set earlier.
  if (relationsChanged) {
    await assertRelations(ctx, { customerId: effectiveCustomerId, customerRequestId: effectiveCustomerRequestId })
  }

  const statusFields = computeStatusFields(existing.status, { status: input.status, closedAt: input.closedAt })

  const data = {
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.customerRequestId !== undefined ? { customerRequestId: input.customerRequestId } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...statusFields,
  }

  const updated = await conversationRepository.updateById(ctx.tenant.id, ctx.business.id, id, data)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }
  return updated
}
