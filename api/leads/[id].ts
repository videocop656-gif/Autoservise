import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateLeadSchema, leadIdParamSchema } from '../../src/server/validation/lead.schemas'
import { getLead, updateLead } from '../../src/server/services/leadService'
import { toLeadDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No DELETE here by design: a Lead's lifecycle is tracked via `status`
// (use PATCH { status: "LOST" }), never removed or hidden.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = leadIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Lead not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const lead = await getLead(ctx, id)
      res.status(200).json({ lead: toLeadDto(lead) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateLeadSchema.parse(req.body)
      const lead = await updateLead(ctx, id, input)
      res.status(200).json({ lead: toLeadDto(lead) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
