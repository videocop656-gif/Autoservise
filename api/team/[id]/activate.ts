import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { teamIdParamSchema } from '../../../src/server/validation/team.schemas'
import { activateTeamMember } from '../../../src/server/services/teamService'
import { toTeamUserDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = teamIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const updated = await activateTeamMember(ctx, id)
      res.status(200).json({ member: toTeamUserDto(updated) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
