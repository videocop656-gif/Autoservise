import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { requireRole } from '../../src/server/middleware/requireRole'
import { whatsappTransportStatus } from '../../src/server/channels/whatsappTransport'
import { sendError, ApiError } from '../../src/server/lib/errors'

// MCR-7B1 — GET /api/channels/whatsapp-transport: the WhatsApp transport for
// THIS business (Twilio / mock / none), whether credentials are configured,
// the masked sender assigned to this business, whether the recovery template
// and webhooks are configured. Read-only, secret-free.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)
    requireRole(ctx, 'owner', 'admin', 'manager')
    if (req.method === 'GET') {
      res.status(200).json({ whatsapp: whatsappTransportStatus(ctx.business.id) })
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
