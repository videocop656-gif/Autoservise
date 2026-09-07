import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { workingHoursListSchema } from '../../src/server/validation/businessHours.schemas'
import { listWorkingHours, replaceWorkingHours } from '../../src/server/services/workingHoursService'
import { toWorkingHourDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const hours = await listWorkingHours(ctx)
      res.status(200).json({ hours: hours.map(toWorkingHourDto) })
      return
    }

    if (req.method === 'PUT') {
      const input = workingHoursListSchema.parse(req.body)
      const hours = await replaceWorkingHours(ctx, input)
      res.status(200).json({ hours: hours.map(toWorkingHourDto) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
