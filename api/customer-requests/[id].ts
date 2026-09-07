import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateCustomerRequestSchema, customerRequestIdParamSchema } from '../../src/server/validation/customerRequest.schemas'
import { getCustomerRequest, updateCustomerRequest } from '../../src/server/services/customerRequestService'
import { toCustomerRequestDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No DELETE by design: a CustomerRequest is never removed — its lifecycle is
// tracked via `status` (use PATCH { status: "CLOSED" } / "CANCELLED") — see spec §19.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = customerRequestIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Customer request not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const request = await getCustomerRequest(ctx, id)
      res.status(200).json({ customerRequest: toCustomerRequestDto(request) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateCustomerRequestSchema.parse(req.body)
      const request = await updateCustomerRequest(ctx, id, input)
      res.status(200).json({ customerRequest: toCustomerRequestDto(request) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
