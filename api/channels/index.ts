import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createChannelConnectionSchema } from '../../src/server/validation/channel.schemas'
import { listChannelConnections, createChannelConnection } from '../../src/server/services/channelConnectionService'
import { toChannelConnectionDto } from '../../src/server/lib/dto'
import { sendError, ApiError } from '../../src/server/lib/errors'

// No pagination — a business's channel connections are always a small,
// fixed-ish set (one per real external account), same convention as
// /api/team.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const connections = await listChannelConnections(ctx)
      res.status(200).json({ connections: connections.map(toChannelConnectionDto) })
      return
    }

    if (req.method === 'POST') {
      const input = createChannelConnectionSchema.parse(req.body)
      const created = await createChannelConnection(ctx, input)
      res.status(201).json({ connection: toChannelConnectionDto(created) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
