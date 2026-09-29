import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateServiceFollowUpSchema, serviceFollowUpIdParamSchema } from '../../src/server/validation/serviceFollowUp.schemas'
import { getServiceFollowUp, updateServiceFollowUp } from '../../src/server/services/serviceFollowUpService'
import { toServiceFollowUpDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// Prompt 48 — GET/PATCH /api/follow-ups/:id. PATCH accepts only status
// (through the transition matrix), dueAt ("YYYY-MM-DD", Business-local) and
// note. No DELETE: a follow-up is closed by DISMISSED, never removed.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = serviceFollowUpIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const followUp = await getServiceFollowUp(ctx, id)
      res.status(200).json({ followUp: toServiceFollowUpDto(followUp) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateServiceFollowUpSchema.parse(req.body)
      const followUp = await updateServiceFollowUp(ctx, id, input)
      res.status(200).json({ followUp: toServiceFollowUpDto(followUp) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
