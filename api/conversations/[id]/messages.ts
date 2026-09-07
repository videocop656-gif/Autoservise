import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { createMessageSchema } from '../../../src/server/validation/message.schemas'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { createMessage } from '../../../src/server/services/messageService'
import { toMessageDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Messages are append-only (spec §12): only POST exists here. There is no
// PATCH/DELETE for an individual message, and this file itself has no GET
// — the full message list is already returned as part of
// GET /api/conversations/:id (spec §24-25).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
    }
    const conversationId = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = createMessageSchema.parse(req.body)
      const message = await createMessage(ctx, conversationId, input)
      res.status(201).json({ message: toMessageDto(message) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
