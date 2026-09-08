import type { AuthContext } from '../types/auth'
import { serviceRepository } from '../repositories/serviceRepository'
import { knowledgeRepository } from '../repositories/knowledgeRepository'
import { businessRuleRepository } from '../repositories/businessRuleRepository'
import { customerRepository } from '../repositories/customerRepository'
import { vehicleRepository } from '../repositories/vehicleRepository'
import { customerRequestRepository } from '../repositories/customerRequestRepository'
import type { AiBusinessContext } from './types'

interface ConversationRef {
  customerId: string | null
  customerRequestId: string | null
}

/**
 * Builds the ONLY data the AI provider ever sees about this business. This
 * is the single place that principle is enforced — see spec "AI CONTEXT" /
 * "НЕ ПЕРЕДАВАТЬ AI" / "CUSTOMER PRIVACY":
 *
 *  - tenantId/businessId/internal ids/session data/secrets: never included,
 *    at all — every field below is hand-picked, never a raw Prisma row.
 *  - Customer.notes: deliberately excluded (spec explicitly calls this out
 *    as "only if truly necessary" — Prompt 09 doesn't have a mechanism to
 *    decide that, so the safe default is to never include it).
 *  - Service history: deliberately NOT included by default (spec: "только
 *    если она действительно нужна для запроса" — deciding *when* it's
 *    needed requires intent-based selective loading, which is exactly the
 *    Tool Layer explicitly deferred to Prompt 10+). Documented as a
 *    conscious NOT IMPLEMENTED choice in the Prompt 09 report, not an
 *    oversight.
 *  - Vehicle: Conversation itself has no vehicleId field (see
 *    prisma/schema.prisma) — a vehicle only becomes "known" when the
 *    Conversation is linked to a CustomerRequest that itself has one. If
 *    only customerId is known (no linked CustomerRequest, or one with no
 *    vehicle), vehicle context stays null rather than guessing which of
 *    the customer's vehicles is relevant.
 *  - Every lookup is tenant/business-scoped via the existing repositories
 *    (same withTenant()-backed pattern as every other domain), so this can
 *    never load another tenant's data even if a foreign id somehow reached
 *    this function.
 */
export async function buildAiContext(ctx: AuthContext, conversation: ConversationRef): Promise<AiBusinessContext> {
  const [services, knowledge, rules] = await Promise.all([
    serviceRepository.listByBusiness(ctx.tenant.id, ctx.business.id, true),
    knowledgeRepository.listByBusiness(ctx.tenant.id, ctx.business.id, { activeOnly: true }),
    businessRuleRepository.listByBusiness(ctx.tenant.id, ctx.business.id, { activeOnly: true }),
  ])

  let customer: AiBusinessContext['customer'] = null
  let vehicle: AiBusinessContext['vehicle'] = null

  if (conversation.customerId) {
    const found = await customerRepository.findById(ctx.tenant.id, ctx.business.id, conversation.customerId)
    if (found) {
      customer = { firstName: found.firstName, lastName: found.lastName, phone: found.phone, email: found.email }
    }
  }

  if (conversation.customerRequestId) {
    const request = await customerRequestRepository.findById(ctx.tenant.id, ctx.business.id, conversation.customerRequestId)
    if (request?.vehicleId) {
      const foundVehicle = await vehicleRepository.findById(ctx.tenant.id, ctx.business.id, request.vehicleId)
      if (foundVehicle) {
        vehicle = {
          make: foundVehicle.make,
          model: foundVehicle.model,
          year: foundVehicle.year,
          licensePlate: foundVehicle.licensePlate,
          mileage: foundVehicle.mileage,
        }
      }
    }
  }

  return {
    business: {
      name: ctx.business.name,
      description: ctx.business.description,
      phone: ctx.business.phone,
      email: ctx.business.email,
      address: ctx.business.address,
      timezone: ctx.business.timezone,
      currency: ctx.business.currency,
    },
    services: services.map((s) => ({
      name: s.name,
      description: s.description,
      priceFrom: s.priceFrom ? s.priceFrom.toFixed(2) : null,
      priceTo: s.priceTo ? s.priceTo.toFixed(2) : null,
      currency: s.currency,
      durationMinutes: s.durationMinutes,
    })),
    knowledge: knowledge.map((k) => ({ title: k.title, content: k.content, category: k.category })),
    rules: rules.map((r) => ({ name: r.name, description: r.description, category: r.category, priority: r.priority })),
    customer,
    vehicle,
  }
}
