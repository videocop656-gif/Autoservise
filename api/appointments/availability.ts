import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { intervalAvailabilityQuerySchema, dayAvailabilityQuerySchema } from '../../src/server/validation/appointment.schemas'
import { checkIntervalAvailability, checkAvailability } from '../../src/server/services/appointmentService'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

// Prompt 50 — GET /api/appointments/availability: read-only check of one
// interval for the current business (working hours + vehicle conflict +
// service-bay capacity), the same rules POST /api/appointments enforces.
// Query: serviceId, startAt (ISO 8601 with offset), optional endAt
// (default startAt + service duration), vehicleId, excludeAppointmentId.
//
// Prompt 51 — day mode, same endpoint: `date` (Business-local YYYY-MM-DD)
// instead of `startAt` returns every bookable slot of that day for the
// service (existing 30-minute generator: working hours, service duration,
// capacity, not already started, vehicle conflict when vehicleId is given,
// the rescheduled appointment excluded). `date` and `startAt` are mutually
// exclusive.
//
// The business, its timezone and capacity always come from the session.
// Any authenticated staff member may ask (same as reading appointments).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const date = singleQueryValue(req.query.date)
      const startAt = singleQueryValue(req.query.startAt)
      if (date !== undefined && startAt !== undefined) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Pass either date or startAt, not both')
      }

      if (date !== undefined) {
        const input = dayAvailabilityQuerySchema.parse({
          serviceId: singleQueryValue(req.query.serviceId),
          date,
          vehicleId: singleQueryValue(req.query.vehicleId),
          excludeAppointmentId: singleQueryValue(req.query.excludeAppointmentId),
        })
        const result = await checkAvailability(ctx, input)
        res.status(200).json({ availability: result })
        return
      }

      const input = intervalAvailabilityQuerySchema.parse({
        serviceId: singleQueryValue(req.query.serviceId),
        startAt,
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
