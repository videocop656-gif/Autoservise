import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { updateKnowledgeItemSchema, knowledgeIdParamSchema } from '../../src/server/validation/knowledge.schemas'
import { getKnowledgeItem, updateKnowledgeItem, deactivateKnowledgeItem } from '../../src/server/services/knowledgeService'
import { toKnowledgeItemDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = knowledgeIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      // Malformed id can't possibly match a row; respond the same as "not
      // found" so the id format never leaks information.
      throw new ApiError(404, 'NOT_FOUND', 'Knowledge item not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const item = await getKnowledgeItem(ctx, id)
      res.status(200).json({ item: toKnowledgeItemDto(item) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateKnowledgeItemSchema.parse(req.body)
      const item = await updateKnowledgeItem(ctx, id, input)
      res.status(200).json({ item: toKnowledgeItemDto(item) })
      return
    }

    if (req.method === 'DELETE') {
      await deactivateKnowledgeItem(ctx, id)
      res.status(200).json({ success: true })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
