import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { serviceFollowUpStatusQuerySchema } from '../../src/server/validation/serviceFollowUp.schemas'
import { listServiceFollowUps } from '../../src/server/services/serviceFollowUpService'
import { toServiceFollowUpDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseDateQueryParam, parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// Prompt 48 — GET /api/follow-ups?status=&dueBefore=&customerId=&vehicleId=
// All filters optional; always tenant/business-scoped; ordered dueAt ASC.
// Follow-ups are only ever created by saving a ServiceRecord, so there is
// deliberately no POST here.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const status = parseEnumQueryParam(serviceFollowUpStatusQuerySchema, req.query.status, 'status')
      const dueBefore = parseDateQueryParam(req.query.dueBefore, 'dueBefore')
      const customerId = singleQueryValue(req.query.customerId)
      const vehicleId = singleQueryValue(req.query.vehicleId)

      const { items, total } = await listServiceFollowUps(ctx, { page, pageSize, status, dueBefore, customerId, vehicleId })
      res.status(200).json(buildPaginatedResult(items.map(toServiceFollowUpDto), page, pageSize, total))
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
