import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { teamIdParamSchema, updateTeamMemberProfileSchema } from '../../src/server/validation/team.schemas'
import { getTeamMember, updateTeamMemberProfile } from '../../src/server/services/teamService'
import { toTeamUserDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// PATCH here is profile fields ONLY (name/email) — role and isActive each
// have their own dedicated action endpoint (role.ts/activate.ts/
// deactivate.ts), never a generic field here (spec §12).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = teamIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const member = await getTeamMember(ctx, id)
      res.status(200).json({ member: toTeamUserDto(member) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateTeamMemberProfileSchema.parse(req.body)
      const updated = await updateTeamMemberProfile(ctx, id, input)
      res.status(200).json({ member: toTeamUserDto(updated) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
