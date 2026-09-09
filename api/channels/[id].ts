import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { channelIdParamSchema, updateChannelConnectionSchema } from '../../src/server/validation/channel.schemas'
import { getChannelConnection, updateChannelConnection } from '../../src/server/services/channelConnectionService'
import { toChannelConnectionDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// PATCH here is profile fields ONLY (displayName/externalAccountId/config)
// — status changes exclusively through activate.ts/deactivate.ts (spec
// §"CHANNEL PATCH").
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const connection = await getChannelConnection(ctx, id)
      res.status(200).json({ connection: toChannelConnectionDto(connection) })
      return
    }

    if (req.method === 'PATCH') {
      const input = updateChannelConnectionSchema.parse(req.body)
      const updated = await updateChannelConnection(ctx, id, input)
      res.status(200).json({ connection: toChannelConnectionDto(updated) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
