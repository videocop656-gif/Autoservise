import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateAppointmentSchema, appointmentIdParamSchema } from '../../src/server/validation/appointment.schemas'
import { getAppointment, updateAppointment } from '../../src/server/services/appointmentService'
import { toAppointmentDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No DELETE by design: an Appointment's lifecycle is tracked via `status`
// (use PATCH { status: "CANCELLED" }), never removed — see spec §25.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = appointmentIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Appointment not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const appointment = await getAppointment(ctx, id)
      res.status(200).json({ appointment: toAppointmentDto(appointment) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateAppointmentSchema.parse(req.body)
      const appointment = await updateAppointment(ctx, id, input)
      res.status(200).json({ appointment: toAppointmentDto(appointment) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
