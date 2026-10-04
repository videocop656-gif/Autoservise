import type { ConversationChannel, ConversationStatus } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { conversationRepository } from '../repositories/conversationRepository'
import { customerRepository } from '../repositories/customerRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { escalationRepository } from '../repositories/escalationRepository'
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
 * CustomerRequest's create-only rule.
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

  // customerRequestId is never written here (Prompt 49.1): the schema rejects
  // it, and the link is only set by the "Создать обращение" bridge. The
  // existing link still constrains a customer change below.
  // Only re-validate what's actually changing — a plain subject edit, or a
  // status change, is never blocked by a relation set earlier.
  if (input.customerId !== undefined) {
    // Prompt 54 — a conversation with a linked request keeps that request's
    // customer: clearing it would leave the conversation contradicting its
    // own request (a different customer is already refused by assertRelations).
    if (input.customerId === null && existing.customerRequestId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Cannot unlink the customer of a conversation with a linked customer request')
    }
    await assertRelations(ctx, { customerId: input.customerId, customerRequestId: existing.customerRequestId })
  }

  const statusFields = computeStatusFields(existing.status, { status: input.status, closedAt: input.closedAt })

  const data = {
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...statusFields,
  }

  const updated = await conversationRepository.updateById(ctx.tenant.id, ctx.business.id, id, data)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
  }
  return updated
}

// --- MCR-5: automatic AI for one conversation --------------------------------
//
// Pause: AI stops answering this conversation's new inbound messages (an
// already-running turn re-checks the pause before it sends). Resume: an
// explicit operator decision — never implied by a draft, a qualification or a
// new customer message — and it restarts the consecutive-turn counter. An
// open escalation must be resolved first: the AI never talks over a handoff.

export type AiAutomationAction = 'pause' | 'resume'

export async function setConversationAiAutomation(ctx: AuthContext, id: string, action: AiAutomationAction) {
  requireRole(ctx, 'owner', 'admin', 'manager')
  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
  }
  if (action === 'pause') {
    if (conversation.aiAutomationPausedAt) return conversation
    const updated = await conversationRepository.setAiAutomation(ctx.tenant.id, ctx.business.id, id, {
      aiAutomationPausedAt: new Date(),
      aiAutomationPausedReason: 'OPERATOR_PAUSED',
    })
    return updated ?? conversation
  }
  const active = await escalationRepository.findActiveByConversation(ctx.tenant.id, ctx.business.id, id)
  if (active) {
    throw new ApiError(409, 'ESCALATION_ACTIVE', 'Сначала завершите эскалацию по этому диалогу, затем возобновите AI')
  }
  const updated = await conversationRepository.setAiAutomation(ctx.tenant.id, ctx.business.id, id, {
    aiAutomationPausedAt: null,
    aiAutomationPausedReason: null,
    aiAutomationResumedAt: new Date(),
  })
  return updated ?? conversation
}
