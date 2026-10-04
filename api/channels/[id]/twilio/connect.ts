import type { ApiRequest, ApiResponse } from '../../../../src/server/types/http'
import { requireAuth } from '../../../../src/server/middleware/requireAuth'
import { channelIdParamSchema } from '../../../../src/server/validation/channel.schemas'
import { connectTwilioSender, disconnectTwilioSender } from '../../../../src/server/services/twilioConnectionService'
import { toChannelConnectionDto } from '../../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../../src/server/lib/errors'

// MCR-7B1 — POST /api/channels/:id/twilio/connect   → attach the business's assigned Twilio sender
//           DELETE /api/channels/:id/twilio/connect → detach it (owner/admin). No body: the
// server decides the number from configuration; a client can never name one.
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    const ctx = await requireAuth(req)
    if (req.method === 'POST') {
      res.status(200).json({ connection: toChannelConnectionDto(await connectTwilioSender(ctx, idResult.data)) })
      return
    }
    if (req.method === 'DELETE') {
      res.status(200).json({ connection: toChannelConnectionDto(await disconnectTwilioSender(ctx, idResult.data)) })
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
