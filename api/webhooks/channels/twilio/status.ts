import type { ApiRequest, ApiResponse } from '../../../../src/server/types/http'
import { handleTwilioStatus } from '../../../../src/server/services/twilioWebhookService'
import { twilioWebhookUrl } from '../../../../src/server/channels/whatsappTransport'
import { logger } from '../../../../src/server/lib/logger'

// ============================================================================
// MCR-7B1 — POST /api/webhooks/channels/twilio/status: the StatusCallback we
// set on every outbound WhatsApp message. Same signature rule as inbound
// (canonical URL); routes ONLY by the stored provider MessageSid.
// ============================================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end()
    return
  }
  try {
    const base = twilioWebhookUrl('/api/webhooks/channels/twilio/status')
    const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : ''
    const result = await handleTwilioStatus({ body: req.body, url: base ? base + query : null, signature: req.headers['x-twilio-signature'] })
    res.statusCode = result.httpStatus
    res.end()
  } catch (err) {
    logger.error('twilio_status_failed', { message: err instanceof Error ? err.message : 'unknown' })
    res.statusCode = 503
    res.end()
  }
}
