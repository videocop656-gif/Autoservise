import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { createMockTelephonyAdapter } from '../../../src/server/telephony/adapters/mockTelephonyAdapter'
import { TelephonyPayloadError } from '../../../src/server/telephony/types'
import { ingestCallEvent, CallIntakeError } from '../../../src/server/services/callIntakeService'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// MCR-2 — MOCK telephony webhook: POST /api/webhooks/telephony/mock.
//
// Called by the (mock) provider, not by a logged-in user: there is no
// session. Order of operations:
//   1. provider authentication (X-Mock-Telephony-Secret) — BEFORE parsing or
//      any database access; disabled unless TELEPHONY_MOCK_WEBHOOK_SECRET is
//      set, and always disabled in production;
//   2. parse into a provider-neutral NormalizedCallEvent (any tenantId /
//      businessId in the body is dropped);
//   3. ingestCallEvent — routing by the called number only; for a READY call
//      it also publishes the durable recovery job (MCR-4.1). The recovery
//      SEND never happens here — it runs in the queue consumer.
//
// Responses (never a tenant, business, customer or call id):
//   200 { ok: true, status: "accepted" | "duplicate" }  — duplicates are 200 so
//                                                         provider retries stop
//   401 UNAUTHORIZED          wrong/missing secret (or mock disabled)
//   400 INVALID_PAYLOAD       not a valid mock event (permanent)
//   422 UNROUTABLE_NUMBER     no active business number matches (permanent, nothing written)
//   409 CALL_ROUTING_CONFLICT the call id already belongs to another business (nothing written)
//   500 INTERNAL_ERROR        transient — the provider should retry; idempotency makes that safe
//                             (includes: event recorded but recovery job publish failed)
// ============================================================================
const adapter = createMockTelephonyAdapter()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }

  if (!adapter.verify({ headers: req.headers, body: req.body }).ok) {
    logger.warn('telephony_webhook_unauthorized', { provider: adapter.provider })
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } })
    return
  }

  let event
  try {
    event = adapter.parse(req.body)
  } catch (err) {
    if (err instanceof TelephonyPayloadError) {
      res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid telephony event' } })
      return
    }
    throw err
  }

  try {
    const result = await ingestCallEvent(event)
    if (result.recoveryJob === 'PUBLISH_FAILED') {
      // MCR-4.1 — the event IS recorded (call durable in READY); only the
      // recovery trigger is missing. 500 makes the provider retry: the retry
      // is a duplicate event that re-publishes (same idempotency key). If it
      // never comes, the internal processor still finds the READY call.
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
      return
    }
    res.status(200).json({ ok: true, status: result.status })
  } catch (err) {
    if (err instanceof CallIntakeError) {
      logger.info('telephony_webhook_rejected', { provider: adapter.provider, code: err.code })
      const status = err.code === 'UNROUTABLE_NUMBER' ? 422 : 409
      res.status(status).json({ error: { code: err.code, message: 'Event not accepted' } })
      return
    }
    logger.error('telephony_webhook_failed', { provider: adapter.provider, message: err instanceof Error ? err.message : 'unknown' })
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
  }
}
