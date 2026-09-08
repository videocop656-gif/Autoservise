import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { aiLogOperationFilterSchema, aiLogOutcomeFilterSchema } from '../../src/server/validation/aiLog.schemas'
import { listAiLogs } from '../../src/server/services/aiLogService'
import { toAiLogDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseEnumQueryParam, parseDateQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// GET only, deliberately (spec §"CLIENT INPUT"): there is no generic
// POST /api/ai-logs — a log row is only ever written by aiLogService.ts
// itself, from aiService.ts/escalationService.ts, never from a client
// request. The read API accepts only filters.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const operation = parseEnumQueryParam(aiLogOperationFilterSchema, req.query.operation, 'operation')
      const outcome = parseEnumQueryParam(aiLogOutcomeFilterSchema, req.query.outcome, 'outcome')
      const conversationId = singleQueryValue(req.query.conversationId)
      const escalationId = singleQueryValue(req.query.escalationId)
      const dateFrom = req.query.dateFrom !== undefined ? parseDateQueryParam(req.query.dateFrom, 'dateFrom') : undefined
      const dateTo = req.query.dateTo !== undefined ? parseDateQueryParam(req.query.dateTo, 'dateTo') : undefined

      const { items, total } = await listAiLogs(ctx, {
        page,
        pageSize,
        operation,
        outcome,
        conversationId,
        escalationId,
        dateFrom,
        dateTo,
      })
      res.status(200).json(buildPaginatedResult(items.map((log) => toAiLogDto(log)), page, pageSize, total))
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
