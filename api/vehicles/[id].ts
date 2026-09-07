import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateVehicleSchema, vehicleIdParamSchema } from '../../src/server/validation/vehicle.schemas'
import { getVehicle, updateVehicle, deactivateVehicle } from '../../src/server/services/vehicleService'
import { toVehicleDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = vehicleIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Vehicle not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const vehicle = await getVehicle(ctx, id)
      res.status(200).json({ vehicle: toVehicleDto(vehicle) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateVehicleSchema.parse(req.body)
      const vehicle = await updateVehicle(ctx, id, input)
      res.status(200).json({ vehicle: toVehicleDto(vehicle) })
      return
    }

    if (req.method === 'DELETE') {
      await deactivateVehicle(ctx, id)
      res.status(200).json({ success: true })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
