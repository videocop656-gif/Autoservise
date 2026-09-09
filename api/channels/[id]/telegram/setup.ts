import type { ApiRequest, ApiResponse } from '../../../../src/server/types/http'
import { requireAuth } from '../../../../src/server/middleware/requireAuth'
import { channelIdParamSchema } from '../../../../src/server/validation/channel.schemas'
import { setupTelegramConnection } from '../../../../src/server/services/telegramSetupService'
import { toChannelConnectionDto } from '../../../../src/server/lib/dto'
import { sendError, ApiError } from '../../../../src/server/lib/errors'

// Prompt 18 spec §32 — the only way a TELEGRAM ChannelConnection can become
// ACTIVE once a real bot token is configured server-side (see
// telegramSetupService.ts / channelConnectionService.ts's
// activateChannelConnection()). Authenticated exactly like every other
// /api/channels/:id/* route (the normal session cookie) — this is a staff
// action, never called by Telegram itself (that's api/webhooks/telegram/).
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const idResult = channelIdParamSchema.safeParse(req.query.id)
    if (!idResult.success) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    const id = idResult.data

    const ctx = await requireAuth(req)

    if (req.method === 'POST') {
      const result = await setupTelegramConnection(ctx, id)
      // Never the bot token/webhook secret (spec §36) — only the same safe
      // ChannelConnectionDto every other channel endpoint returns, plus the
      // bot's own public @username (never a secret).
      res.status(200).json({ connection: toChannelConnectionDto(result.connection), telegram: { username: result.botUsername } })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
