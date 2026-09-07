import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import {
  createConversationSchema,
  conversationStatusFilterSchema,
  conversationChannelFilterSchema,
} from '../../src/server/validation/conversation.schemas'
import { listConversations, createConversation } from '../../src/server/services/conversationService'
import { toConversationDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const status = parseEnumQueryParam(conversationStatusFilterSchema, req.query.status, 'status')
      const channel = parseEnumQueryParam(conversationChannelFilterSchema, req.query.channel, 'channel')
      const customerId = singleQueryValue(req.query.customerId)
      const customerRequestId = singleQueryValue(req.query.customerRequestId)
      const search = singleQueryValue(req.query.search)?.trim() || undefined

      const { items, total } = await listConversations(ctx, {
        page,
        pageSize,
        status,
        channel,
        customerId,
        customerRequestId,
        search,
      })
      res.status(200).json(buildPaginatedResult(items.map(toConversationDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createConversationSchema.parse(req.body)
      const conversation = await createConversation(ctx, input)
      res.status(201).json({ conversation: toConversationDto(conversation) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
