import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { customerRequestIdParamSchema } from '../../../src/server/validation/customerRequest.schemas'
import { confirmRequestBookingSchema } from '../../../src/server/validation/requestBooking.schemas'
import { getRequestBooking, confirmRequestBooking } from '../../../src/server/services/requestBookingService'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 56 — booking confirmation from a CustomerRequest.
//   GET  → 200 { booking }  (readiness, preference, linked appointment; read-only)
//   POST { startAt, expectedRequestUpdatedAt } → 201 { booking, created: true }
//        already booked → 200 { booking, created: false } (no second appointment)
// Errors (Russian messages): 400 BOOKING_NOT_READY / SERVICE_INACTIVE /
// VEHICLE_INACTIVE / CUSTOMER_INACTIVE / VALIDATION_ERROR, 404, 409
// CAPACITY_EXCEEDED / APPOINTMENT_CONFLICT / OUTSIDE_WORKING_HOURS /
// BOOKING_TIME_PASSED / BOOKING_STALE / REQUEST_FINISHED / REQUEST_INCONSISTENT.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = customerRequestIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Заявка не найдена.')
    }
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      res.status(200).json({ booking: await getRequestBooking(ctx, idResult.data) })
      return
    }

    if (req.method === 'POST') {
      const input = confirmRequestBookingSchema.parse(req.body ?? {})
      const { booking, created } = await confirmRequestBooking(ctx, idResult.data, input)
      res.status(created ? 201 : 200).json({ booking, created })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
