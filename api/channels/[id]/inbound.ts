import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { requireAuth } from '../../../src/server/middleware/requireAuth'
import { channelIdParamSchema, inboundChannelPayloadSchema } from '../../../src/server/validation/channel.schemas'
import { receiveIncoming } from '../../../src/server/services/channelMessageService'
import { sendError, ApiError } from '../../../src/server/lib/errors'

// ============================================================================
// DEVELOPMENT / FOUNDATION ENDPOINT — NOT A PRODUCTION-SECURE WEBHOOK.
//
// This is Channel Integration Foundation (Prompt 16), not a real Telegram/
// WhatsApp webhook receiver. It is authenticated exactly like every other
// endpoint in this API (the normal session cookie via requireAuth()) —
// there is no per-provider webhook-signature verification here at all,
// because no real provider is connected yet (spec §"WEBHOOK FOUNDATION").
// A real production webhook for a specific provider (verifying that
// provider's own signature scheme, accepting unauthenticated requests from
// that provider's IP/token) is explicitly out of scope for this stage —
// see docs/DEVELOPMENT_ROADMAP.md Prompt 16 for the documented limitation.
//
// The payload accepted here is intentionally already normalized-message-
// shaped (spec's own test/mock payload contract) — never tenantId/
// businessId/customerId/conversationId (spec §"INBOUND ENDPOINT SECURITY"):
// those are always resolved server-side from the :id-selected
// ChannelConnection and the resolution services, never accepted from the
// request body.
// ============================================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const payload = inboundChannelPayloadSchema.parse(req.body)
      const result = await receiveIncoming(ctx, id, payload)
      res.status(200).json(result)
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
