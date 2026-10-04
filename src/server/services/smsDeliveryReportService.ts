import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { maskPhone } from '../lib/phone'
import { canAdvanceDeliveryState, isFinalDeliveryState, mapMobizonStatus } from '../channels/deliveryStatus'
import { mobizonWebhookSchema, verifyMobizonSignature } from '../channels/adapters/mobizon/mobizonWebhook'
import { MOBIZON_PROVIDER } from '../channels/adapters/mobizon/mobizonSmsAdapter'
import { mobizonAdapter } from '../channels/smsTransport'
import { smsDeliveryReportRepository } from '../repositories/smsDeliveryReportRepository'

// ---------------------------------------------------------------------------
// MCR-7A — Mobizon "sms-delivery-report" processing. Order (nothing is
// written before step 2 passes):
//   1. parse (bounded, zod)                         → 400 malformed
//   2. verify sign with MOBIZON_WEBHOOK_SECRET      → 403 (no secret: 503, never accept)
//   3. other event types                            → 200, recorded, ignored
//   4. eventId already processed                    → 200 (idempotent)
//   5. find OUR delivery by (mobizon, messageId)    → unknown: 200, recorded
//   6. data.to must be the number we sent to        → mismatch: 200, recorded, ignored
//   7. authoritative status via Message.GetSMSStatus (the signature does not
//      cover `data`)                                 → lookup failed: 503 (Mobizon retries)
//   8. monotonic state change + event row, one transaction
// Responses never contain a tenant, business, customer, call or message.
// Status changes never create a Message, a CallInteraction change, a bridge
// event or AI work: they only describe carrier delivery of what was sent.
// ---------------------------------------------------------------------------

export type WebhookOutcome = { httpStatus: 200 | 400 | 403 | 503; outcome: string }

function decodeBody(body: unknown): unknown {
  if (typeof body === 'string') {
    if (body.length > 64 * 1024) return null
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  return body
}

export async function handleMobizonWebhook(body: unknown, now: Date = new Date()): Promise<WebhookOutcome> {
  const secret = env.mobizonWebhookSecret
  if (!secret) {
    logger.warn('sms_webhook_rejected', { provider: MOBIZON_PROVIDER, reason: 'SECRET_NOT_CONFIGURED' })
    return { httpStatus: 503, outcome: 'NOT_CONFIGURED' }
  }
  const parsed = mobizonWebhookSchema.safeParse(decodeBody(body))
  if (!parsed.success) return { httpStatus: 400, outcome: 'MALFORMED' }
  const event = parsed.data
  if (!verifyMobizonSignature(event, secret)) {
    logger.warn('sms_webhook_rejected', { provider: MOBIZON_PROVIDER, reason: 'BAD_SIGNATURE' })
    return { httpStatus: 403, outcome: 'BAD_SIGNATURE' }
  }

  // --- authentic from here on ---
  const eventId = event.eventId
  if (event.eventType !== 'sms-delivery-report') {
    await smsDeliveryReportRepository.recordEvent(MOBIZON_PROVIDER, eventId, 'IGNORED_EVENT_TYPE')
    return { httpStatus: 200, outcome: 'IGNORED_EVENT_TYPE' }
  }
  if (await smsDeliveryReportRepository.findEvent(MOBIZON_PROVIDER, eventId)) return { httpStatus: 200, outcome: 'DUPLICATE' }

  const messageId = event.data?.messageId
  const found = messageId ? await smsDeliveryReportRepository.findDelivery(MOBIZON_PROVIDER, messageId) : null
  if (!found) {
    await smsDeliveryReportRepository.recordEvent(MOBIZON_PROVIDER, eventId, 'UNKNOWN_MESSAGE')
    logger.info('sms_webhook_unknown_message', { provider: MOBIZON_PROVIDER, eventId })
    return { httpStatus: 200, outcome: 'UNKNOWN_MESSAGE' }
  }
  const { delivery, destinationThread } = found

  const reportedTo = event.data?.to?.replace(/^\+/, '') ?? null
  if (!reportedTo || !destinationThread || reportedTo !== destinationThread.replace(/^\+/, '')) {
    await smsDeliveryReportRepository.recordEvent(MOBIZON_PROVIDER, eventId, 'DESTINATION_MISMATCH', delivery.id)
    logger.warn('sms_webhook_destination_mismatch', { provider: MOBIZON_PROVIDER, eventId, deliveryId: delivery.id, reportedTo: maskPhone(reportedTo ? `+${reportedTo}` : null) })
    return { httpStatus: 200, outcome: 'DESTINATION_MISMATCH' }
  }

  // The report's `data` is unsigned: read the real status from Mobizon itself.
  const adapter = mobizonAdapter()
  const lookup = adapter ? await adapter.fetchStatus(messageId!) : ({ ok: false, reason: 'TRANSPORT_NOT_CONFIGURED' } as const)
  if (!lookup.ok) {
    logger.warn('sms_webhook_status_lookup_failed', { provider: MOBIZON_PROVIDER, eventId, deliveryId: delivery.id, reason: lookup.reason })
    return { httpStatus: 503, outcome: 'STATUS_LOOKUP_FAILED' } // no event row: Mobizon retries the same eventId
  }

  const next = mapMobizonStatus(lookup.status)
  const current = delivery.providerDeliveryState
  const outcome = !next
    ? isFinalDeliveryState(current)
      ? 'NO_CHANGE'
      : 'STATUS_OBSERVED' // unknown / future code: kept for observability, never "delivered"
    : canAdvanceDeliveryState(current, next)
      ? 'APPLIED'
      : 'NO_CHANGE' // out of order or after a final state: never regress
  const result = await smsDeliveryReportRepository.applyReport({
    provider: MOBIZON_PROVIDER,
    eventId,
    deliveryId: delivery.id,
    expectedState: current,
    outcome,
    data: {
      ...(outcome === 'APPLIED' && next ? { providerDeliveryState: next } : {}),
      providerStatus: lookup.status.slice(0, 40),
      providerStatusAt: now,
      providerSegments: lookup.segNum,
    },
  })
  logger.info('sms_delivery_report', { provider: MOBIZON_PROVIDER, eventId, deliveryId: delivery.id, status: lookup.status, state: next, result })
  return { httpStatus: 200, outcome: result === 'DUPLICATE' ? 'DUPLICATE' : outcome }
}
