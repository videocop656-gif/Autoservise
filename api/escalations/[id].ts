import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { escalationIdParamSchema } from '../../src/server/validation/escalation.schemas'
import { getEscalation } from '../../src/server/services/escalationService'
import { toAiEscalationDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// GET only. No PATCH here, deliberately (spec §"API": "do not create
// duplicate ways to perform the same state transition without a reason")
// — every state change goes through one of the dedicated action endpoints
// (claim.ts/resolve.ts/cancel.ts) instead of a generic PATCH.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = escalationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Escalation not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const escalation = await getEscalation(ctx, id)
      res.status(200).json({ escalation: toAiEscalationDto(escalation) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
