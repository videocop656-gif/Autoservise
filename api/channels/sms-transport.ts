import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { requireRole } from '../../src/server/middleware/requireRole'
import { smsTransportStatus } from '../../src/server/channels/smsTransport'
import { sendError, ApiError } from '../../src/server/lib/errors'

// MCR-7A — GET /api/channels/sms-transport: which SMS transport the server
// uses (Mobizon / mock / none), whether it is fully configured, the sender
// label and whether the delivery webhook secret is set. Read-only and
// secret-free: the API key and webhook secret never leave the server.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)
    requireRole(ctx, 'owner', 'admin', 'manager')
    if (req.method === 'GET') {
      res.status(200).json({ sms: smsTransportStatus() })
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
