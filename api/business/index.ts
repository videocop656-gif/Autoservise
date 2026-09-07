import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { businessProfileSchema } from '../../src/server/validation/business.schemas'
import { updateBusinessProfile } from '../../src/server/services/businessService'
import { toBusinessDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      // Read access: owner, admin, and manager (no requireRole call — any
      // authenticated staff member of the tenant may view the profile).
      res.status(200).json({ business: toBusinessDto(ctx.business) })
      return
    }

    if (req.method === 'PATCH') {
      const input = businessProfileSchema.parse(req.body)
      const updated = await updateBusinessProfile(ctx, input)
      res.status(200).json({ business: toBusinessDto(updated) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
