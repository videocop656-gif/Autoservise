import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { businessRepository } from '../../src/server/repositories/businessRepository'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
    }

    const ctx = await requireAuth(req)
    const business = await businessRepository.findFirstByTenant(ctx.tenant.id)

    res.status(200).json({ user: ctx.user, tenant: ctx.tenant, business })
  } catch (err) {
    sendError(res, err)
  }
}
