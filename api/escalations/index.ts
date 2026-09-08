import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { escalationStatusFilterSchema, escalationPriorityFilterSchema } from '../../src/server/validation/escalation.schemas'
import { listEscalations } from '../../src/server/services/escalationService'
import { toAiEscalationDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// No POST here, deliberately (spec §"CREATE API SECURITY"): an escalation
// is never created by a client request — only by AiService, via
// escalationService.createOrReuseActiveEscalation(), after a validated AI
// result with needsHuman=true. There is no way for any authenticated user
// to manufacture an arbitrary escalation through this API.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const status = parseEnumQueryParam(escalationStatusFilterSchema, req.query.status, 'status')
      const priority = parseEnumQueryParam(escalationPriorityFilterSchema, req.query.priority, 'priority')
      const assignedUserId = singleQueryValue(req.query.assignedUserId)
      const unassignedOnly = req.query.unassignedOnly === 'true'
      const customerId = singleQueryValue(req.query.customerId)
      const conversationId = singleQueryValue(req.query.conversationId)

      const { items, total } = await listEscalations(ctx, {
        page,
        pageSize,
        status,
        priority,
        assignedUserId,
        unassignedOnly,
        customerId,
        conversationId,
      })
      res.status(200).json(buildPaginatedResult(items.map(toAiEscalationDto), page, pageSize, total))
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
