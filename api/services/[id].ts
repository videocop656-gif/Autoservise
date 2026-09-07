import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateServiceSchema, serviceIdParamSchema } from '../../src/server/validation/service.schemas'
import { getService, updateService, deactivateService } from '../../src/server/services/serviceCatalogService'
import { toServiceDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = serviceIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      // Malformed id can't possibly match a row; respond the same as "not
      // found" rather than a validation error, so the id format never
      // leaks information about what a real id looks like.
      throw new ApiError(404, 'NOT_FOUND', 'Service not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const service = await getService(ctx, id)
      res.status(200).json({ service: toServiceDto(service) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateServiceSchema.parse(req.body)
      const service = await updateService(ctx, id, input)
      res.status(200).json({ service: toServiceDto(service) })
      return
    }

    if (req.method === 'DELETE') {
      await deactivateService(ctx, id)
      res.status(200).json({ success: true })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
