import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { setConversationAiAutomation } from '../../../src/server/services/conversationService'
import { toConversationDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// MCR-5 — POST /api/conversations/:id/ai-automation { action: "pause" | "resume" }:
// the operator's per-conversation control over automatic AI replies.
// Owner/admin/manager (day-to-day conversation work). Returns the conversation.
const bodySchema = z.object({ action: z.enum(['pause', 'resume']) }).strict()

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }
    const ctx = await requireAuth(req)
    if (req.method === 'POST') {
      const { action } = bodySchema.parse(req.body)
      const conversation = await setConversationAiAutomation(ctx, idResult.data, action)
      res.status(200).json({ conversation: toConversationDto(conversation) })
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
