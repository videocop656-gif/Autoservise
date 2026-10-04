import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { requireRole } from '../../src/server/middleware/requireRole'
import { connectKcell, disconnectKcell, telephonyStatus } from '../../src/server/services/kcellConnectionService'
import { sendError, ApiError } from '../../src/server/lib/errors'

// MCR-8A — /api/telephony/kcell
//   GET    → telephony status of THIS business (provider, connection, masked numbers); secret-free
//   POST   → activate the Kcell connection prepared on the server (owner/admin)
//   DELETE → disable it (owner/admin)
// No body: the CRM token is server configuration and never accepted from a browser.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)
    if (req.method === 'GET') {
      requireRole(ctx, 'owner', 'admin', 'manager')
      res.status(200).json({ telephony: await telephonyStatus(ctx) })
      return
    }
    if (req.method === 'POST') {
      res.status(200).json({ telephony: await connectKcell(ctx) })
      return
    }
    if (req.method === 'DELETE') {
      res.status(200).json({ telephony: await disconnectKcell(ctx) })
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
