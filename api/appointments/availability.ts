import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { intervalAvailabilityQuerySchema } from '../../src/server/validation/appointment.schemas'
import { checkIntervalAvailability } from '../../src/server/services/appointmentService'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// Prompt 50 — GET /api/appointments/availability: read-only check of one
// interval for the current business (working hours + vehicle conflict +
// service-bay capacity), the same rules POST /api/appointments enforces.
// Query: serviceId, startAt (ISO 8601 with offset), optional endAt
// (default startAt + service duration), vehicleId, excludeAppointmentId.
// The business, its timezone and capacity always come from the session.
// Any authenticated staff member may ask (same as reading appointments).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const input = intervalAvailabilityQuerySchema.parse({
        serviceId: singleQueryValue(req.query.serviceId),
        startAt: singleQueryValue(req.query.startAt),
        endAt: singleQueryValue(req.query.endAt),
        vehicleId: singleQueryValue(req.query.vehicleId),
        excludeAppointmentId: singleQueryValue(req.query.excludeAppointmentId),
      })
      const result = await checkIntervalAvailability(ctx, input)
      res.status(200).json({ availability: result })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
