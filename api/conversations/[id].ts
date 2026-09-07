import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateConversationSchema, conversationIdParamSchema } from '../../src/server/validation/conversation.schemas'
import { getConversation, updateConversation } from '../../src/server/services/conversationService'
import { toConversationDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No DELETE by design: a Conversation is never removed — close it via
// PATCH { status: "CLOSED" } (and reopen via { status: "OPEN" }) instead.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Conversation not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const conversation = await getConversation(ctx, id)
      res.status(200).json({ conversation: toConversationDto(conversation) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateConversationSchema.parse(req.body)
      const conversation = await updateConversation(ctx, id, input)
      res.status(200).json({ conversation: toConversationDto(conversation) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
