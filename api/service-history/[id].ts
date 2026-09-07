import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateServiceRecordSchema, serviceRecordIdParamSchema } from '../../src/server/validation/serviceRecord.schemas'
import { getServiceRecord, updateServiceRecord } from '../../src/server/services/serviceRecordService'
import { toServiceRecordDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No hard delete by design: a ServiceRecord is permanent operational
// history (§14). Archive/restore both go through PATCH { isArchived }.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = serviceRecordIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Service record not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      // Archived records remain reachable by id — archiving only hides a
      // record from the default list, it never revokes access to it.
      const record = await getServiceRecord(ctx, id)
      res.status(200).json({ record: toServiceRecordDto(record) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateServiceRecordSchema.parse(req.body)
      const record = await updateServiceRecord(ctx, id, input)
      res.status(200).json({ record: toServiceRecordDto(record) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
