import { logger } from '../lib/logger'
import { maskPhone } from '../lib/phone'
import { prisma } from '../db/prisma'
import { KCELL_PROVIDER, kcellBusinessForToken, kcellCommand, kcellParams, parseKcell } from '../telephony/adapters/kcell/kcellTelephonyAdapter'
import { TelephonyPayloadError, type NormalizedCallEvent } from '../telephony/types'
import { telephonyConnectionRepository } from '../repositories/telephonyConnectionRepository'
import { CallIntakeError, ingestCallEvent } from './callIntakeService'

// ---------------------------------------------------------------------------
// MCR-8A — POST /api/webhooks/telephony/kcell (Kcell Virtual PBX CRM API).
//
// Order — nothing is read from or written to the database before step 2:
//   1. bounded params (form or JSON)                          → 400
//   2. crm_token → the ONE business it is configured for       → 401 {error:"Invalid token"}
//   3. that business's Kcell connection must be ACTIVE         → 401 (same answer)
//   4. cmd: contact → 200 {} (no caller data is ever returned);
//      unknown cmd                                              → 400
//   5. parse event / history → NormalizedCallEvent             → 400
//   6. no called number on the callback (diversion is optional for events):
//      only an ALREADY KNOWN call of this business can take it; else ignored
//   7. ingestCallEvent: routing by the called number, which must belong to
//      the token's business (else ignored like an unknown number); one
//      CallInteraction per callid; CallEvent fingerprint idempotency;
//      monotonic outcome; READY → the existing missed-call-recovery job.
// Recovery never runs here — it runs in the queue consumer.
//
// Every "can't use it" after authentication answers 200 {} — Kcell documents
// only 200 / 400 / 401, and a 200 stops redelivery without revealing whether a
// number or business exists. 500 only for a transient failure (incl. a failed
// job publish), so a retry — idempotent — can re-publish.
// ---------------------------------------------------------------------------

export interface KcellWebhookResult {
  httpStatus: 200 | 400 | 401 | 500
  body: Record<string, unknown>
  /** For logs / tests only — never sent to Kcell. */
  outcome: string
}

const ok = (outcome: string): KcellWebhookResult => ({ httpStatus: 200, body: {}, outcome })
const invalid = (outcome: string): KcellWebhookResult => ({ httpStatus: 400, body: { error: 'Invalid parameters' }, outcome })
const unauthorized = (outcome: string): KcellWebhookResult => ({ httpStatus: 401, body: { error: 'Invalid token' }, outcome })

export async function handleKcellWebhook(input: { body: unknown; now?: Date }): Promise<KcellWebhookResult> {
  const receivedAt = input.now ?? new Date()
  const params = kcellParams(input.body)
  if (!params) return invalid('MALFORMED')

  const businessId = kcellBusinessForToken(params.crm_token)
  if (!businessId) {
    logger.warn('kcell_webhook_rejected', { reason: 'BAD_TOKEN' })
    return unauthorized('BAD_TOKEN')
  }
  const connection = await telephonyConnectionRepository.findActiveForWebhook(businessId, KCELL_PROVIDER)
  if (!connection) {
    logger.warn('kcell_webhook_rejected', { reason: 'CONNECTION_INACTIVE' })
    return unauthorized('CONNECTION_INACTIVE')
  }

  // --- authentic, for an active connection, from here on ---
  const cmd = kcellCommand(params)
  if (cmd === 'contact') return ok('CONTACT_NOT_PROVIDED')
  if (!cmd) return invalid('UNKNOWN_COMMAND')

  let event: NormalizedCallEvent
  try {
    event = parseKcell(params)
  } catch (err) {
    if (err instanceof TelephonyPayloadError) return invalid('INVALID_PAYLOAD')
    throw err
  }

  const businessSide = event.direction === 'INBOUND' ? event.calledPhone : event.callerPhone
  if (!businessSide) {
    // Only a call this business already has (routed earlier by its number) can take a number-less callback.
    const known = await prisma.callInteraction.findFirst({
      where: { provider: KCELL_PROVIDER, providerCallId: event.providerCallId, tenantId: connection.tenantId, businessId: connection.businessId },
      select: { businessPhoneNumberId: true },
    })
    const number = known
      ? await prisma.businessPhoneNumber.findFirst({ where: { id: known.businessPhoneNumberId, tenantId: connection.tenantId, businessId: connection.businessId }, select: { phoneE164: true } })
      : null
    if (!number) {
      logger.info('kcell_webhook_ignored', { reason: 'NO_CALLED_NUMBER', status: event.providerStatus })
      return ok('NO_CALLED_NUMBER')
    }
    event = event.direction === 'INBOUND' ? { ...event, calledPhone: number.phoneE164 } : { ...event, callerPhone: number.phoneE164 }
  }

  try {
    const result = await ingestCallEvent(event, receivedAt, { expectedBusinessId: connection.businessId })
    logger.info('kcell_call_event', {
      status: event.providerStatus,
      result: result.status,
      callInteractionId: result.callInteractionId,
      outcome: result.outcome,
      recoveryState: result.recoveryState,
      recoveryJob: result.recoveryJob,
      caller: maskPhone(event.direction === 'INBOUND' ? event.callerPhone : event.calledPhone),
    })
    if (result.recoveryJob === 'PUBLISH_FAILED') return { httpStatus: 500, body: { error: 'Temporary error' }, outcome: 'PUBLISH_FAILED' }
    return ok(result.status === 'duplicate' ? 'DUPLICATE' : 'ACCEPTED')
  } catch (err) {
    if (err instanceof CallIntakeError) {
      logger.warn('kcell_webhook_ignored', { reason: err.code })
      return ok(err.code)
    }
    logger.error('kcell_webhook_failed', { message: err instanceof Error ? err.message : 'unknown' })
    return { httpStatus: 500, body: { error: 'Temporary error' }, outcome: 'INTERNAL_ERROR' }
  }
}
