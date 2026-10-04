import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { handleMobizonWebhook } from '../../../src/server/services/smsDeliveryReportService'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// MCR-7A — POST /api/webhooks/channels/mobizon: Mobizon "Статусы SMS"
// (sms-delivery-report) webhook. Public by nature — no session. Authenticity
// = Mobizon's documented SHA1 signature with MOBIZON_WEBHOOK_SECRET, checked
// before ANY database write (see smsDeliveryReportService). 2xx stops
// Mobizon's retries; 503 asks for a retry (same eventId, idempotent).
// Responses carry no tenant / business / customer / call / message data.
// ============================================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false })
    return
  }
  try {
    const result = await handleMobizonWebhook(req.body)
    res.status(result.httpStatus).json({ ok: result.httpStatus === 200 })
  } catch (err) {
    logger.error('sms_webhook_failed', { provider: 'mobizon', message: err instanceof Error ? err.message : 'unknown' })
    res.status(503).json({ ok: false })
  }
}
