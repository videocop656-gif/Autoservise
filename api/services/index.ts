import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createServiceSchema } from '../../src/server/validation/service.schemas'
import { listServices, createService } from '../../src/server/services/serviceCatalogService'
import { toServiceDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      // ?activeOnly=false lets any authenticated staff member (including
      // manager) see inactive services too; default is active-only.
      const activeOnly = req.query.activeOnly !== 'false'
      const services = await listServices(ctx, activeOnly)
      res.status(200).json({ services: services.map(toServiceDto) })
      return
    }

    if (req.method === 'POST') {
      const input = createServiceSchema.parse(req.body)
      const service = await createService(ctx, input)
      res.status(201).json({ service: toServiceDto(service) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
