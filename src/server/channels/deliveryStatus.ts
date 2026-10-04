import type { ProviderDeliveryState } from '@prisma/client'

// ---------------------------------------------------------------------------
// MCR-7A — carrier delivery state AFTER a provider accepted a message
// (ChannelDelivery.status = SENT). Provider-neutral; each provider maps its
// own codes here. The ONE monotonic rule lives here too.
//
//   rank 1  ACCEPTED              in transit (provider / operator has it)
//   rank 2  PARTIALLY_DELIVERED   some segments delivered, not final
//   rank 3  DELIVERED                                      (may still become READ)
//   rank 3  UNDELIVERED | EXPIRED | REJECTED               terminal failures
//   rank 4  READ (MCR-7B1, WhatsApp read receipt)          terminal
//
// A report may move the state only to a HIGHER rank. Terminal states never
// change (a late "sent" after "delivered" is ignored; so is "failed" after
// "delivered", or "delivered" after "read"). An unknown provider code changes no state — it is kept as
// providerStatus for observability and never counted as delivered.
// ---------------------------------------------------------------------------

const RANK: Record<ProviderDeliveryState, number> = {
  ACCEPTED: 1,
  PARTIALLY_DELIVERED: 2,
  DELIVERED: 3,
  UNDELIVERED: 3,
  EXPIRED: 3,
  REJECTED: 3,
  READ: 4,
}

const TERMINAL: ReadonlySet<ProviderDeliveryState> = new Set(['UNDELIVERED', 'EXPIRED', 'REJECTED', 'READ'])

/** Delivered or a failure — the carrier outcome is known (READ included). */
export function isFinalDeliveryState(state: ProviderDeliveryState | null | undefined): boolean {
  return !!state && RANK[state] >= 3
}

/** Whether a report may change `current` to `next` (strictly forward; finals are terminal). */
export function canAdvanceDeliveryState(current: ProviderDeliveryState | null | undefined, next: ProviderDeliveryState | null): boolean {
  if (!next) return false
  if (!current) return true
  if (TERMINAL.has(current)) return false
  if (current === 'DELIVERED') return next === 'READ'
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

/**
 * MCR-7B1 — Twilio message statuses (official Message resource): queued,
 * accepted, scheduled, sending, sent (in transit) · delivered · read
 * (WhatsApp; also EventType=READ) · undelivered, failed, canceled.
 * "received" / "receiving" are inbound-only and never apply to a delivery.
 */
const TWILIO_STATUS: Record<string, ProviderDeliveryState> = {
  queued: 'ACCEPTED',
  accepted: 'ACCEPTED',
  scheduled: 'ACCEPTED',
  sending: 'ACCEPTED',
  sent: 'ACCEPTED',
  delivered: 'DELIVERED',
  read: 'READ',
  undelivered: 'UNDELIVERED',
  failed: 'UNDELIVERED',
  canceled: 'UNDELIVERED',
}

export function mapTwilioStatus(status: unknown, eventType?: unknown): ProviderDeliveryState | null {
  if (typeof eventType === 'string' && eventType.trim().toUpperCase() === 'READ') return 'READ'
  return typeof status === 'string' ? (TWILIO_STATUS[status.trim().toLowerCase()] ?? null) : null
}
