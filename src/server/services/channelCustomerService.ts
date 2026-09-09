import type { AuthContext } from '../types/auth'
import { customerChannelIdentityRepository } from '../repositories/customerChannelIdentityRepository'
import { customerRepository } from '../repositories/customerRepository'

/** Strips everything but digits — the first half of the "last 10 digits" heuristic; see customerRepository.ts's findActiveByLocalPhoneNumber() for why this exact, deliberately simple approach was chosen over a full phone-parsing library. */
function localSubscriberNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-10)
}

export interface CustomerResolution {
  customerId: string | null
  /** Set only when a customer was resolved via phone-matching and no CustomerChannelIdentity exists yet for this externalCustomerId — channelMessageService.ts creates the identity link as a separate, best-effort step AFTER the inbound message is durably recorded (never inside the same transaction — spec §"CUSTOMER IDENTITY CONFLICT" must never roll back a real inbound message just because linking the identity lost a race). */
  newIdentityToLink: { externalCustomerId: string; phone?: string; displayName?: string } | null
}

const NO_MATCH: CustomerResolution = { customerId: null, newIdentityToLink: null }

/**
 * Spec §"CUSTOMER RESOLUTION" — deliberately minimal, in this exact order:
 *
 * 1. An existing CustomerChannelIdentity for this externalCustomerId always
 *    wins — this is what prevents the "silent reassignment" spec
 *    §"CUSTOMER IDENTITY CONFLICT" forbids: once an external identity is
 *    linked to a Customer, every later message from that same external id
 *    resolves to the SAME Customer, never re-matched by phone.
 * 2. Otherwise, if a phone was provided, look for exactly one active
 *    Customer with a matching local subscriber number. Zero or more than
 *    one match — including because two different active customers happen
 *    to share the same last-10-digits, or because "how many is ambiguous"
 *    genuinely can't be resolved safely — leaves the conversation
 *    unlinked, deliberately (spec: "если однозначного customer нет —
 *    Conversation может остаться без customer" / never автоматическое
 *    объединение клиентов).
 * 3. No automatic Customer creation, ever, no matter what — there is no
 *    code path in this function that calls customerRepository.create().
 */
export async function resolveCustomerForInbound(
  ctx: AuthContext,
  channelConnectionId: string,
  payload: { externalCustomerId?: string; customerPhone?: string; customerName?: string }
): Promise<CustomerResolution> {
  if (payload.externalCustomerId) {
    const existingIdentity = await customerChannelIdentityRepository.findByConnectionAndExternalCustomerId(
      ctx.tenant.id,
      ctx.business.id,
      channelConnectionId,
      payload.externalCustomerId
    )
    if (existingIdentity) {
      return { customerId: existingIdentity.customerId, newIdentityToLink: null }
    }
  }

  if (!payload.customerPhone) {
    return NO_MATCH
  }

  const localNumber = localSubscriberNumber(payload.customerPhone)
  if (localNumber.length === 0) {
    return NO_MATCH
  }

  const matches = await customerRepository.findActiveByLocalPhoneNumber(ctx.tenant.id, ctx.business.id, localNumber)
  if (matches.length !== 1) {
    // Zero matches (unknown) or more than one (ambiguous) — never guess.
    return NO_MATCH
  }

  return {
    customerId: matches[0]!.id,
    newIdentityToLink: payload.externalCustomerId
      ? { externalCustomerId: payload.externalCustomerId, phone: payload.customerPhone, displayName: payload.customerName }
      : null,
  }
}

/**
 * Best-effort, called only AFTER the inbound message itself is durably
 * recorded (channelMessageService.ts) — never inside that transaction.
 * Never throws: a genuine conflict (two concurrent first-contacts
 * resolving to different customers for the same externalCustomerId) is a
 * real, expected race the DB's own unique constraint catches (P2002);
 * losing that race must never be treated as "the inbound message failed"
 * — the message is already safely stored regardless.
 */
export async function linkCustomerIdentityBestEffort(
  ctx: AuthContext,
  channelConnectionId: string,
  customerId: string,
  identity: { externalCustomerId: string; phone?: string; displayName?: string }
): Promise<void> {
  try {
    await customerChannelIdentityRepository.create({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      customerId,
      channelConnectionId,
      externalCustomerId: identity.externalCustomerId,
      displayName: identity.displayName ?? null,
      phone: identity.phone ?? null,
    })
  } catch {
    // Swallowed deliberately — see this function's own doc comment above.
    // A future message from the same external id will simply re-resolve
    // by phone again (or find whichever identity actually won the race).
  }
}
