import type { ProviderDeliveryState } from '@prisma/client'

// ---------------------------------------------------------------------------
// MCR-7A — carrier delivery state AFTER a provider accepted a message
// (ChannelDelivery.status = SENT). Provider-neutral; each provider maps its
// own codes here. The ONE monotonic rule lives here too.
//
//   rank 1  ACCEPTED              in transit (provider / operator has it)
//   rank 2  PARTIALLY_DELIVERED   some segments delivered, not final
//   rank 3  DELIVERED | UNDELIVERED | EXPIRED | REJECTED   final
//
// A report may move the state only to a HIGHER rank; once final, nothing
// changes it (a late "ACCEPTD" after "DELIVRD" is ignored; so is a second,
// different final). An unknown provider code changes no state — it is kept as
// providerStatus for observability and never counted as delivered.
// ---------------------------------------------------------------------------

const RANK: Record<ProviderDeliveryState, number> = {
  ACCEPTED: 1,
  PARTIALLY_DELIVERED: 2,
  DELIVERED: 3,
  UNDELIVERED: 3,
  EXPIRED: 3,
  REJECTED: 3,
}

export function isFinalDeliveryState(state: ProviderDeliveryState | null | undefined): boolean {
  return !!state && RANK[state] === 3
}

/** Whether a report may change `current` to `next` (strictly forward; finals are terminal). */
export function canAdvanceDeliveryState(current: ProviderDeliveryState | null | undefined, next: ProviderDeliveryState | null): boolean {
  if (!next) return false
  if (!current) return true
  if (isFinalDeliveryState(current)) return false
  return RANK[next] > RANK[current]
}

/**
 * Mobizon message statuses (official table "Список возможных статусов
 * сообщений"): NEW, ENQUEUD, ACCEPTD (not final), PDLIVRD (partial, not
 * final), DELIVRD, UNDELIV, REJECTD, EXPIRED, DELETED (final).
 */
const MOBIZON_STATUS: Record<string, ProviderDeliveryState> = {
  NEW: 'ACCEPTED',
  ENQUEUD: 'ACCEPTED',
  ACCEPTD: 'ACCEPTED',
  PDLIVRD: 'PARTIALLY_DELIVERED',
  DELIVRD: 'DELIVERED',
  UNDELIV: 'UNDELIVERED',
  DELETED: 'UNDELIVERED',
  EXPIRED: 'EXPIRED',
  REJECTD: 'REJECTED',
}

/** null = unknown / future status: observable, but never a state change. */
export function mapMobizonStatus(status: unknown): ProviderDeliveryState | null {
  return typeof status === 'string' ? (MOBIZON_STATUS[status.trim().toUpperCase()] ?? null) : null
}
