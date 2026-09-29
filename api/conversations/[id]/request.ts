import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { createRequestFromConversationSchema } from '../../../src/server/validation/conversationRequest.schemas'
import { createCustomerRequestFromConversation } from '../../../src/server/services/conversationRequestService'
import { toConversationDto, toCustomerRequestDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 49 — POST /api/conversations/:id/request: "Создать обращение" from a
// conversation. Idempotent: 201 when a new CustomerRequest was created and
// linked; 200 with the already-linked request on every later call (retry,
// double click, second tab) — never a second request for the same
// conversation. Same response shape as POST /api/follow-ups/:id/request.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = createRequestFromConversationSchema.parse(req.body ?? {})
      const { conversation, request, created } = await createCustomerRequestFromConversation(ctx, id, input)
      res.status(created ? 201 : 200).json({
        conversation: toConversationDto(conversation),
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
