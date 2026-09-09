import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { channelIdParamSchema } from '../../../src/server/validation/channel.schemas'
import { deactivateChannelConnection } from '../../../src/server/services/channelConnectionService'
import { toChannelConnectionDto } from '../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// Never deletes Conversation/Message/ChannelMessage/CustomerChannelIdentity
// (spec §"ACTIVATE / DEACTIVATE") — only blocks future inbound/outbound
// processing through this connection.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const updated = await deactivateChannelConnection(ctx, id)
      res.status(200).json({ connection: toChannelConnectionDto(updated) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
