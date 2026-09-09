import type { ApiRequest, ApiResponse } from '../../../../../src/server/types/http'
import { requireAuth } from '../../../../../src/server/middleware/requireAuth'
import { channelIdParamSchema, channelDeliveryMessageIdParamSchema } from '../../../../../src/server/validation/channel.schemas'
import { sendMessageViaChannel } from '../../../../../src/server/services/channelDeliveryService'
import { sendError, ApiError } from '../../../../../src/server/lib/errors'

// Channel Operations & Delivery Foundation (Prompt 17 spec §17) —
// :id = ChannelConnection, :messageId = an already-existing Message. The
// request body is never read: tenantId/businessId/conversationId/customerId/
// externalConversationId are always resolved server-side from the URL and
// the existing Message/Conversation, never accepted from a client payload
// (spec §8, §17, §26) — there is nothing for a client-supplied body to
// override here even if one is sent.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    const channelConnectionId = idResult.data

    const messageIdResult = channelDeliveryMessageIdParamSchema.safeParse(req.query.messageId)
    if (!messageIdResult.success) {
      throw new ApiError(404, 'MESSAGE_NOT_FOUND', 'Message not found')
    }
    const messageId = messageIdResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const delivery = await sendMessageViaChannel(ctx, channelConnectionId, messageId)
      res.status(200).json(delivery)
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
