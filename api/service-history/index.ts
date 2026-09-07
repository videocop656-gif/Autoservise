import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createServiceRecordSchema } from '../../src/server/validation/serviceRecord.schemas'
import { listServiceRecords, createServiceRecord } from '../../src/server/services/serviceRecordService'
import { toServiceRecordDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseDateQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const customerId = singleQueryValue(req.query.customerId)
      const vehicleId = singleQueryValue(req.query.vehicleId)
      const serviceId = singleQueryValue(req.query.serviceId)
      const dateFrom = parseDateQueryParam(req.query.dateFrom, 'dateFrom')
      const dateTo = parseDateQueryParam(req.query.dateTo, 'dateTo')
      const includeArchived = req.query.includeArchived === 'true'

      const { items, total } = await listServiceRecords(ctx, {
        page,
        pageSize,
        customerId,
        vehicleId,
        serviceId,
        dateFrom,
        dateTo,
        includeArchived,
      })
      res.status(200).json(buildPaginatedResult(items.map(toServiceRecordDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createServiceRecordSchema.parse(req.body)
      const record = await createServiceRecord(ctx, input)
      res.status(201).json({ record: toServiceRecordDto(record) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
