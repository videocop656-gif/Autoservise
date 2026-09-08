import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { aiLogIdParamSchema } from '../../src/server/validation/aiLog.schemas'
import { getAiLog } from '../../src/server/services/aiLogService'
import { toAiLogDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// GET only — an AI log is never created or modified through the API (spec §"CLIENT INPUT").
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = aiLogIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'AI log not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const log = await getAiLog(ctx, id)
      res.status(200).json({ log: toAiLogDto(log, { detail: true }) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
