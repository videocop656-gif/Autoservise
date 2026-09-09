import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createTeamMemberSchema } from '../../src/server/validation/team.schemas'
import { listTeam, createTeamMember } from '../../src/server/services/teamService'
import { toTeamUserDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No pagination (spec §9 lists it as a plain list, and a business's team is
// always small) — matches businessRepository.listByTenant()'s own
// unpaginated convention for a similarly small, tenant-owned collection.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const members = await listTeam(ctx)
      res.status(200).json({ members: members.map(toTeamUserDto) })
      return
    }

    if (req.method === 'POST') {
      const input = createTeamMemberSchema.parse(req.body)
      const created = await createTeamMember(ctx, input)
      res.status(201).json({ member: toTeamUserDto(created) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
