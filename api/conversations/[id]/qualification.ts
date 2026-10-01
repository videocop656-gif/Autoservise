import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { requestQualificationActionSchema } from '../../../src/server/validation/requestQualification.schemas'
import { analyzeRequestQualification, applyRequestQualification } from '../../../src/server/services/requestQualificationService'
import { toCustomerRequestDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 55 — POST /api/conversations/:id/qualification ("Разобрать обращение").
//   { action: "analyze" } → 200 { qualification }  (AI proposal; nothing written)
//   { action: "create", expectedCustomerId, vehicleId?, serviceId?, subject, description?,
//     requestedDate? (YYYY-MM-DD), requestedTimeFrom?, requestedTimeTo? } → 201 { customerRequest }
//   { action: "update", …same, expectedRequestId, expectedRequestUpdatedAt } → 200 { customerRequest }
// Errors: 404, 409 QUALIFICATION_STALE / CONVERSATION_HAS_NO_CUSTOMER /
// REQUEST_FINISHED / NO_CUSTOMER_MESSAGE, 502 AI_QUALIFICATION_UNAVAILABLE /
// AI_PROVIDER_UNAVAILABLE — operator-facing Russian messages.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = requestQualificationActionSchema.parse(req.body ?? {})
      if (input.action === 'analyze') {
        const qualification = await analyzeRequestQualification(ctx, idResult.data)
        res.status(200).json({ qualification })
        return
      }
      const { request, created } = await applyRequestQualification(ctx, idResult.data, input)
      res.status(created ? 201 : 200).json({ customerRequest: toCustomerRequestDto(request), created })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
