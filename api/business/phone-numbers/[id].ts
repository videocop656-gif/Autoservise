import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { setBusinessPhoneNumberActiveSchema, businessPhoneNumberIdParamSchema } from '../../../src/server/validation/businessPhoneNumber.schemas'
import { setBusinessPhoneNumberActive } from '../../../src/server/services/businessPhoneNumberService'
import { toBusinessPhoneNumberDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// MCR-2 — PATCH /api/business/phone-numbers/:id { isActive } (owner/admin).
// Deactivating releases the number for routing; re-activating fails with 409
// if another business took it meanwhile. No delete: call history references it.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = businessPhoneNumberIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) throw new ApiError(404, 'NOT_FOUND', 'Номер не найден.')
    const ctx = await requireAuth(req)

    if (req.method === 'PATCH') {
      const input = setBusinessPhoneNumberActiveSchema.parse(req.body)
      const number = await setBusinessPhoneNumberActive(ctx, idResult.data, input.isActive)
      res.status(200).json({ phoneNumber: toBusinessPhoneNumberDto(number) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
