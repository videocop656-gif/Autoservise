import type { CallDirection, CallEventType } from '@prisma/client'

// ---------------------------------------------------------------------------
// MCR-2 — the provider-neutral telephony boundary.
//
// Every provider webhook (mock today; a real provider in MCR-8) is turned into
// a NormalizedCallEvent by its TelephonyAdapter BEFORE the core sees it. The
// core (callIntakeService) never reads provider JSON. There is deliberately no
// tenantId/businessId here: the tenant is resolved server-side from the
// business-side phone number (BusinessPhoneNumber), never from the payload.
// ---------------------------------------------------------------------------

export interface NormalizedCallEvent {
  /** Stable provider key, e.g. "mock". Namespaces providerCallId / providerEventId. */
  provider: string
  /** The provider's id of THIS event — the idempotency key for redeliveries. */
  providerEventId: string
  /** The provider's id of the call — all events of one call share it. */
  providerCallId: string
  eventType: CallEventType
  direction: CallDirection
  /** The number that dialled, as the provider sent it; null when hidden/anonymous. */
  callerPhone: string | null
  /** The number that was dialled, as the provider sent it. */
  calledPhone: string
  /** Provider event time; null if the provider gave none (never invented). */
  occurredAt: Date | null
  /**
   * COMPLETED only: whether the call was answered before it ended, when the
   * provider says so (true/false); null when the provider doesn't report it.
   */
  wasAnswered: boolean | null
  /**
   * MCR-8A — optional call-summary times some providers report with the final
   * record (Kcell history: start + duration). Provider times only; never
   * invented from receipt time.
   */
  callStartedAt?: Date | null
  callEndedAt?: Date | null
  /** MCR-8A — the provider's own short status code, kept on the CallEvent ledger (no PII). */
  providerStatus?: string | null
}

/** Outcome of verifying the provider's authentication of a webhook request. */
export type TelephonyAuthResult =
  | {
      ok: true
      /**
       * MCR-8A — for providers whose secret identifies one configured provider
       * account (Kcell: one CRM token per business), the business that secret
       * belongs to. The called number must then route to the SAME business.
       */
      accountBusinessId?: string
    }
  | { ok: false }

export interface TelephonyWebhookRequest {
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

/**
 * The one boundary a real provider implements (MCR-8). `verify` runs before
 * any parsing or database access; `parse` is pure and throws
 * TelephonyPayloadError for anything it can't map.
 */
export interface TelephonyAdapter {
  readonly provider: string
  verify(request: TelephonyWebhookRequest): TelephonyAuthResult
  parse(body: unknown): NormalizedCallEvent
}

export class TelephonyPayloadError extends Error {}
