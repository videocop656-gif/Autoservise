import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { handleKcellWebhook } from '../../../src/server/services/kcellWebhookService'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// MCR-8A — POST /api/webhooks/telephony/kcell: the ONE CRM URL configured in
// the Kcell Virtual PBX ("Интеграция с CRM по REST API"). Kcell POSTs
// cmd=event / cmd=history / cmd=contact here with crm_token in the body.
// No user session; the CRM token is the provider authentication and is
// checked before anything is read or written (kcellWebhookService).
// Responses follow the Kcell contract: 200 {} · 400 {error:"Invalid
// parameters"} · 401 {error:"Invalid token"}; 500 only for a transient error.
// ============================================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  try {
    const result = await handleKcellWebhook({ body: req.body })
    res.status(result.httpStatus).json(result.body)
  } catch (err) {
    logger.error('kcell_webhook_failed', { message: err instanceof Error ? err.message : 'unknown' })
    res.status(500).json({ error: 'Temporary error' })
  }
}
