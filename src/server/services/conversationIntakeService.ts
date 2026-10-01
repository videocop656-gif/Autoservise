import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { runInTransaction } from '../db/transaction'
import { conversationRepository } from '../repositories/conversationRepository'
import { customerRepository } from '../repositories/customerRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { prepareCustomerCreate } from './customerService'
import { createVehicle } from './vehicleService'
import { localSubscriberNumber } from './channelCustomerService'
import type { CreateCustomerInput } from '../validation/customer.schemas'
import type { ConversationVehicleCreateInput } from '../validation/conversationIntake.schemas'

// ---------------------------------------------------------------------------
// Prompt 54 — Customer & Vehicle intake from a conversation.
//
// Operator-controlled only: nothing here is called by AI or by the inbound
// pipeline. Reuses the existing domain rules (customer create, vehicle
// create, tenant scoping) and the existing phone normalization of the
// channel pipeline. No schema change: Conversation.customerId is the
// conversation's customer; Vehicle belongs to a Customer; the vehicle a
// piece of work is about stays CustomerRequest.vehicleId (chosen when the
// request is created) — a conversation does not "own" a vehicle.
//
// Never touches Conversation.customerRequestId (Prompt 49.1), messages,
// requests, appointments or a vehicle's owner, and sends nothing.
// ---------------------------------------------------------------------------

const STAFF = ['owner', 'admin', 'manager'] as const

const CHANGED = () => new ApiError(409, 'CONVERSATION_CHANGED', 'Данные изменились. Обновите диалог и попробуйте ещё раз.')

/** Max same-phone customers returned to the operator on a duplicate — all from this business only. */
const MAX_PHONE_MATCHES = 5

async function loadConversation(ctx: AuthContext, conversationId: string) {
  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, conversationId)
  if (!conversation) {
    throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
  }
  return conversation
}

/**
 * A conversation with a linked CustomerRequest belongs to that request's
 * customer (the P49 bridge links both together): any other customer would
 * contradict the request, so it is refused rather than rewritten.
 */
async function assertCompatibleWithLinkedRequest(ctx: AuthContext, customerRequestId: string | null, customerId: string): Promise<void> {
  if (!customerRequestId) return
  const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, customerRequestId)
  if (request && request.customerId !== customerId) {
    throw new ApiError(409, 'CUSTOMER_REQUEST_CONFLICT', 'Нельзя изменить клиента: связанное обращение принадлежит другому клиенту.')
  }
}

/**
 * Link an existing customer. Idempotent when it is already the
 * conversation's customer. Replacing a different customer requires the
 * operator to pass the customer they saw (`expectedCustomerId`) — the write
 * is a compare-and-set on it, so a stale tab or a concurrent operator gets a
 * 409 instead of silently overwriting the newer identity.
 */
export async function linkConversationCustomer(
  ctx: AuthContext,
  conversationId: string,
  input: { customerId: string; expectedCustomerId: string | null }
) {
  requireRole(ctx, ...STAFF)

  const conversation = await loadConversation(ctx, conversationId)
  const customer = await customerRepository.findById(ctx.tenant.id, ctx.business.id, input.customerId)
  if (!customer) {
    throw new ApiError(404, 'NOT_FOUND', 'Клиент не найден')
  }
  if (!customer.isActive) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Клиент неактивен — выберите другого')
  }

  if (conversation.customerId === customer.id) {
    return conversation
  }
  if (conversation.customerId !== input.expectedCustomerId) {
    throw CHANGED()
  }
  await assertCompatibleWithLinkedRequest(ctx, conversation.customerRequestId, customer.id)

  const updated = await conversationRepository.setCustomerIfUnchanged(ctx.tenant.id, ctx.business.id, conversationId, input.expectedCustomerId, customer.id)
  if (!updated) {
    throw CHANGED()
  }
  return updated
}

export interface PhoneMatch {
  id: string
  firstName: string
  lastName: string | null
  phone: string
}

/**
 * Create a customer (the existing createCustomer rules: owner/admin,
 * active-email duplicate) and link it — only while the conversation has no
 * customer. Before creating, an active customer of THIS business with the
 * same phone (last 10 digits — the channel pipeline's existing
 * normalization) is reported as 409 CUSTOMER_PHONE_EXISTS with the matches,
 * so the operator links the existing one instead of creating a duplicate.
 * Create + link are one transaction: if the link loses a race, the new
 * customer is rolled back too.
 */
export async function createCustomerForConversation(ctx: AuthContext, conversationId: string, input: CreateCustomerInput) {
  const data = await prepareCustomerCreate(ctx, input) // role + email rules first

  const conversation = await loadConversation(ctx, conversationId)
  if (conversation.customerId) {
    throw new ApiError(409, 'CONVERSATION_HAS_CUSTOMER', 'У диалога уже есть клиент. Обновите диалог.')
  }

  const localNumber = localSubscriberNumber(input.phone)
  if (localNumber.length > 0) {
    const matches = await customerRepository.findActiveByLocalPhoneNumber(ctx.tenant.id, ctx.business.id, localNumber)
    if (matches.length > 0) {
      const found: PhoneMatch[] = []
      for (const { id } of matches.slice(0, MAX_PHONE_MATCHES)) {
        const c = await customerRepository.findById(ctx.tenant.id, ctx.business.id, id)
        if (c) found.push({ id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone })
      }
      throw new ApiError(409, 'CUSTOMER_PHONE_EXISTS', 'Клиент с таким номером уже существует.', { matches: found })
    }
  }

  return runInTransaction(async (tx) => {
    const customer = await customerRepository.create(data, tx)
    const linked = await conversationRepository.setCustomerIfUnchanged(ctx.tenant.id, ctx.business.id, conversationId, null, customer.id, tx)
    if (!linked) {
      throw CHANGED() // another operator linked a customer meanwhile — the new customer is rolled back
    }
    return { conversation: linked, customer }
  })
}

/**
 * Add a vehicle for the conversation's linked customer — the owner comes
 * from the conversation on the server, never from the browser. Reuses
 * createVehicle (owner/admin, tenant-scoped customer). An active vehicle of
 * the SAME customer with the same VIN or licence plate (both already
 * trimmed + uppercased by the existing schema) is returned as 409
 * VEHICLE_EXISTS instead of a duplicate; other customers' vehicles are
 * never looked at or moved.
 */
export async function createVehicleForConversation(ctx: AuthContext, conversationId: string, input: ConversationVehicleCreateInput) {
  requireRole(ctx, 'owner', 'admin')

  const conversation = await loadConversation(ctx, conversationId)
  if (!conversation.customerId) {
    throw new ApiError(409, 'CONVERSATION_HAS_NO_CUSTOMER', 'Сначала свяжите диалог с клиентом.')
  }

  if (input.vin || input.licensePlate) {
    const { items } = await vehicleRepository.list(ctx.tenant.id, ctx.business.id, {
      activeOnly: true,
      customerId: conversation.customerId,
      skip: 0,
      take: 200,
    })
    const existing = items.find(
      (v) => (input.vin && v.vin?.toUpperCase() === input.vin) || (input.licensePlate && v.licensePlate?.toUpperCase() === input.licensePlate)
    )
    if (existing) {
      throw new ApiError(409, 'VEHICLE_EXISTS', 'У клиента уже есть автомобиль с таким VIN или госномером.', {
        vehicle: { id: existing.id, make: existing.make, model: existing.model, year: existing.year, licensePlate: existing.licensePlate },
      })
    }
  }

  return createVehicle(ctx, { ...input, customerId: conversation.customerId })
}
