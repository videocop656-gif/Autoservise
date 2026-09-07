import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createVehicleSchema } from '../../src/server/validation/vehicle.schemas'
import { listVehicles, createVehicle } from '../../src/server/services/vehicleService'
import { toVehicleDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const activeOnly = req.query.includeInactive !== 'true'
      const search = singleQueryValue(req.query.search)?.trim() || undefined
      const customerId = singleQueryValue(req.query.customerId)

      const { items, total } = await listVehicles(ctx, { page, pageSize, activeOnly, search, customerId })
      res.status(200).json(buildPaginatedResult(items.map(toVehicleDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createVehicleSchema.parse(req.body)
      const vehicle = await createVehicle(ctx, input)
      res.status(201).json({ vehicle: toVehicleDto(vehicle) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
