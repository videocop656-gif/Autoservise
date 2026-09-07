import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createAppointmentSchema, appointmentStatusFilterSchema } from '../../src/server/validation/appointment.schemas'
import { listAppointments, createAppointment } from '../../src/server/services/appointmentService'
import { toAppointmentDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseEnumQueryParam, parseDateQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const status = parseEnumQueryParam(appointmentStatusFilterSchema, req.query.status, 'status')
      const customerId = singleQueryValue(req.query.customerId)
      const vehicleId = singleQueryValue(req.query.vehicleId)
      const serviceId = singleQueryValue(req.query.serviceId)
      const dateFrom = parseDateQueryParam(req.query.dateFrom, 'dateFrom')
      const dateTo = parseDateQueryParam(req.query.dateTo, 'dateTo')
      const includeCancelled = req.query.includeCancelled === 'true'

      const { items, total } = await listAppointments(ctx, {
        page,
        pageSize,
        status,
        customerId,
        vehicleId,
        serviceId,
        dateFrom,
        dateTo,
        includeCancelled,
      })
      res.status(200).json(buildPaginatedResult(items.map(toAppointmentDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createAppointmentSchema.parse(req.body)
      const appointment = await createAppointment(ctx, input)
      res.status(201).json({ appointment: toAppointmentDto(appointment) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
