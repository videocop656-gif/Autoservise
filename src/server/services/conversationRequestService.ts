import type { ConversationChannel, CustomerRequestSource, Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { runInTransaction } from '../db/transaction'
import { withTenant } from '../lib/tenantScope'
import { conversationRepository } from '../repositories/conversationRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { createCustomerRequestSchema } from '../validation/customerRequest.schemas'
import type { CreateRequestFromConversationInput } from '../validation/conversationRequest.schemas'
import { prepareCustomerRequestCreate } from './customerRequestService'

// ---------------------------------------------------------------------------
// Prompt 49 — Conversation → CustomerRequest operational bridge.
//
// Reuses the existing relation Conversation.customerRequestId (one FK column
// ⇒ a conversation points to at most one request — the v1 "one primary
// request per conversation" rule — no schema change) and the existing
// CustomerRequest creation rules (prepareCustomerRequestCreate: role,
// tenant-scoped ownership, active customer, vehicle belongs to customer,
// active service, initial status NEW + history row). No AI, no appointment,
// no conversation status change: the conversation stays usable.
// ---------------------------------------------------------------------------

/**
 * Provenance through the EXISTING source enum (no second source system):
 * the conversation's own channel where the two enums share a meaning,
 * OTHER for messenger channels. "It came from a conversation" is carried by
 * the relation itself (the request's linked conversations).
 */
export function requestSourceForChannel(channel: ConversationChannel): CustomerRequestSource {
  switch (channel) {
    case 'PHONE':
      return 'PHONE'
    case 'WEBSITE':
      return 'WEBSITE'
    case 'MANUAL':
      return 'MANUAL'
    default:
      return 'OTHER'
  }
}

// The shared request validation speaks English (its texts are also an
// internal contract of the AI tools — see aiTools.ts), so the bridge
// translates the outcomes an operator can actually hit here, at its own
// boundary. Codes and statuses are kept as-is.
const RUSSIAN_MESSAGES: Record<string, string> = {
  'Customer not found': 'Клиент не найден',
  'Cannot create a customer request for an inactive customer': 'Клиент неактивен — обращение создать нельзя',
  'Vehicle not found': 'Автомобиль не найден',
  'Vehicle does not belong to the specified customer': 'Автомобиль не принадлежит выбранному клиенту',
  'Service not found': 'Услуга не найдена',
  'Service is not active': 'Услуга неактивна — выберите другую',
}

async function inRussian<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof ApiError && RUSSIAN_MESSAGES[err.message]) {
      throw new ApiError(err.statusCode, err.code, RUSSIAN_MESSAGES[err.message]!, err.details)
    }
    throw err
  }
}

/**
 * "Создать обращение" from a conversation. Idempotent under any concurrency,
 * with the same two-phase design as Prompt 48.1's follow-up → request bridge:
 *  1. Reads/validation outside any transaction (conversation, customer,
 *     vehicle, service — via the request's own rules).
 *  2. One short transaction on its own connection: lock the conversation row
 *     (SELECT … FOR UPDATE), re-check, insert request + history, set
 *     conversation.customerRequestId (and customerId if it had none).
 * Concurrent calls queue on the row lock: the first creates and links, every
 * later one sees customerRequestId and returns that same request. If any
 * write fails, the whole transaction rolls back — no request without its
 * link, no link to a missing request.
 */
export async function createCustomerRequestFromConversation(
  ctx: AuthContext,
  conversationId: string,
  input: CreateRequestFromConversationInput
) {
  requireRole(ctx, 'owner', 'admin', 'manager')

  const snapshot = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, conversationId)
  if (!snapshot) {
    throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
  }
  if (snapshot.customerRequestId) {
    const existing = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, snapshot.customerRequestId)
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Обращение не найдено')
    return { conversation: snapshot, request: existing, created: false }
  }

  // The conversation's own customer is always reused — never replaced or
  // duplicated. Only an unlinked conversation takes the operator's choice.
  if (snapshot.customerId && input.customerId && input.customerId !== snapshot.customerId) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'У диалога уже есть клиент — выбрать другого нельзя')
  }
  const customerId = snapshot.customerId ?? input.customerId ?? null
  if (!customerId) {
    throw new ApiError(400, 'CUSTOMER_REQUIRED', 'Клиент не выбран')
  }

  const requestInput = createCustomerRequestSchema.parse({
    customerId,
    vehicleId: input.vehicleId ?? null,
    serviceId: input.serviceId ?? null,
    source: requestSourceForChannel(snapshot.channel),
    subject: input.subject,
    description: input.description ?? null,
  })
  const requestData = await inRussian(() => prepareCustomerRequestCreate(ctx, requestInput))

  return runInTransaction(async (tx) => {
    const conversation = await conversationRepository.findByIdForUpdate(ctx.tenant.id, ctx.business.id, conversationId, tx)
    if (!conversation) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    if (conversation.customerRequestId) {
      return { conversation, request: await loadRequest(ctx, conversation.customerRequestId, tx), created: false }
    }
    if (conversation.customerId !== snapshot.customerId) {
      // Linked to a customer between the validation reads and the lock —
      // never insert a request validated against stale data.
      throw new ApiError(409, 'CONFLICT', 'Диалог изменился во время создания обращения — повторите действие')
    }

    const request = await customerRequestRepository.createWithInitialHistory(requestData, ctx.user.id, tx)
    // Scalar FK fields, same as conversationService.updateConversation:
    // updateById is an updateMany, which only accepts scalars.
    const linkData = {
      customerRequestId: request.id,
      ...(conversation.customerId ? {} : { customerId }),
    }
    const linked = await conversationRepository.updateById(ctx.tenant.id, ctx.business.id, conversationId, linkData, tx)
    if (!linked) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    return { conversation: linked, request, created: true }
  })
}

async function loadRequest(ctx: AuthContext, id: string, tx: Prisma.TransactionClient) {
  const request = await tx.customerRequest.findFirst({ where: withTenant(ctx.tenant.id, { businessId: ctx.business.id, id }) })
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Обращение не найдено')
  return request
}
