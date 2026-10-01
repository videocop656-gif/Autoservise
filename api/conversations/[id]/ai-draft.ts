import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { conversationIdParamSchema } from '../../../src/server/validation/conversation.schemas'
import { generateConversationDraft } from '../../../src/server/services/aiService'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Prompt 53 — POST /api/conversations/:id/ai-draft: "Предложить ответ AI".
// Runs the existing AI core in read-only draft mode against this
// conversation's latest customer message and returns { draft, needsHuman }.
// Creates nothing and sends nothing: the operator edits the text in the
// composer and sends it through the existing POST …/messages + channel send.
// No request body — the conversation and the business come from the URL and
// the session only.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = conversationIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'NOT_FOUND', 'Диалог не найден')
    }

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const result = await generateConversationDraft(ctx, idResult.data)
      res.status(200).json(result)
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
