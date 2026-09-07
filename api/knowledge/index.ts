import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createKnowledgeItemSchema, knowledgeCategoryFilterSchema } from '../../src/server/validation/knowledge.schemas'
import { listKnowledgeItems, createKnowledgeItem } from '../../src/server/services/knowledgeService'
import { toKnowledgeItemDto } from '../../src/server/lib/dto'
import { parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      // ?activeOnly=false lets any authenticated staff member (including
      // manager) see inactive items too; default is active-only, matching
      // the /api/services convention.
      const activeOnly = req.query.activeOnly !== 'false'
      const category = parseEnumQueryParam(knowledgeCategoryFilterSchema, req.query.category, 'category')
      const items = await listKnowledgeItems(ctx, { activeOnly, category })
      res.status(200).json({ items: items.map(toKnowledgeItemDto) })
      return
    }

    if (req.method === 'POST') {
      const input = createKnowledgeItemSchema.parse(req.body)
      const item = await createKnowledgeItem(ctx, input)
      res.status(201).json({ item: toKnowledgeItemDto(item) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
