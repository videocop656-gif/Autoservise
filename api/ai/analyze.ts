import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { analyzeMessageSchema } from '../../src/server/validation/ai.schemas'
import { analyzeMessage } from '../../src/server/services/aiService'
import { sendError, ApiError } from '../../src/server/lib/errors'

// Deliberately thin: no OpenAI SDK, model name, API key, or prompt
// construction detail is visible here at all — see aiService.ts /
// aiProviderFactory.ts / providers/*.ts. This route never creates a
// Message and never performs any action — it only returns a draft
// analysis (spec §"ANALYZE НЕ СОЗДАЁТ MESSAGE" / "НЕ ВЫПОЛНЯЕТ ACTION").
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const input = analyzeMessageSchema.parse(req.body)
      const result = await analyzeMessage(ctx, input)
      res.status(200).json(result)
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
