import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { serviceFollowUpIdParamSchema } from '../../../src/server/validation/serviceFollowUp.schemas'
import { createCustomerRequestFromFollowUp } from '../../../src/server/services/serviceFollowUpService'
import { toServiceFollowUpDto, toCustomerRequestDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 48 — POST /api/follow-ups/:id/request: "Создать обращение".
// Idempotent: 201 when a new CustomerRequest was created, 200 with the
// already-linked request on every repeat call — never a second request.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = serviceFollowUpIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Follow-up not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const { followUp, request, created } = await createCustomerRequestFromFollowUp(ctx, id)
      res.status(created ? 201 : 200).json({
        followUp: toServiceFollowUpDto(followUp),
        customerRequest: toCustomerRequestDto(request),
        created,
      })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
