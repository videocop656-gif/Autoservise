import type { ApiRequest, ApiResponse } from '../../../../src/server/types/http'
import { handleTwilioInbound } from '../../../../src/server/services/twilioWebhookService'
import { twilioWebhookUrl } from '../../../../src/server/channels/whatsappTransport'
import { logger } from '../../../../src/server/lib/logger'

// ============================================================================
// MCR-7B1 — POST /api/webhooks/channels/twilio/inbound: Twilio WhatsApp
// "A message comes in" webhook. Public, no session; authenticity =
// X-Twilio-Signature computed over OUR canonical URL (APP_URL + this path +
// the query string Twilio called) — never a forgeable Host header. Answers
// quickly with empty TwiML: the AI reply runs asynchronously (MCR-5 queue).
// Responses never reveal a tenant, business, customer or conversation.
// ============================================================================
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end()
    return
  }
  try {
    const base = twilioWebhookUrl('/api/webhooks/channels/twilio/inbound')
    const query = (req.url ?? '').includes('?') ? (req.url ?? '').slice((req.url ?? '').indexOf('?')) : ''
    const result = await handleTwilioInbound({ body: req.body, url: base ? base + query : null, signature: req.headers['x-twilio-signature'] })
    res.statusCode = result.httpStatus
    if (result.httpStatus === 200) {
      res.setHeader('Content-Type', 'text/xml; charset=utf-8')
      res.end(EMPTY_TWIML)
      return
    }
    res.end()
  } catch (err) {
    logger.error('twilio_inbound_failed', { message: err instanceof Error ? err.message : 'unknown' })
    res.statusCode = 503
    res.end()
  }
}
