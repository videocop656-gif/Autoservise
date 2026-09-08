import type { ApiRequest, ApiResponse } from '../src/server/types/http'
import { requireAuth } from '../src/server/middleware/requireAuth'
import { parseDashboardPeriod } from '../src/server/validation/analytics.schemas'
import { getDashboard } from '../src/server/services/analyticsService'
import { sendError, ApiError } from '../src/server/lib/errors'

// GET only — the dashboard is a read-only aggregation view. tenantId/
// businessId are never accepted from the client (spec §2/§3): `ctx` below
// comes exclusively from requireAuth()'s session-resolved AuthContext, and
// `getDashboard()`/analyticsRepository.ts have no parameter through which a
// client-supplied id could reach a query.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const period = parseDashboardPeriod(req.query.period)
      const dashboard = await getDashboard(ctx, period)
      res.status(200).json(dashboard)
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
