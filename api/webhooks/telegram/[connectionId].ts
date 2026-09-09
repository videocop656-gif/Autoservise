import type { ApiRequest, ApiResponse } from '../../../src/server/types/http'
import { env } from '../../../src/server/lib/env'
import { timingSafeEqualStrings } from '../../../src/server/lib/timingSafeCompare'
import { channelIdParamSchema } from '../../../src/server/validation/channel.schemas'
import { resolveTelegramWebhookContext } from '../../../src/server/channels/telegramWebhookContext'
import { receiveIncoming } from '../../../src/server/services/channelMessageService'
import { ApiError } from '../../../src/server/lib/errors'
import { logger } from '../../../src/server/lib/logger'

// ============================================================================
// PRODUCTION-SHAPED TELEGRAM WEBHOOK (Prompt 18 spec §15) — distinct from
// the pre-existing api/channels/:id/inbound.ts "foundation" endpoint, which
// stays exactly as it was (spec §38: still authenticated by the normal
// session cookie, still a dev/manual-testing tool, never weakened here).
//
// This endpoint is called directly by Telegram's servers — there is no
// session cookie, no requireAuth(). The ONLY authentication is the shared
// secret Telegram echoes back on every request once configured via
// setWebhook (spec §16/§18): a request without the correct
// X-Telegram-Bot-Api-Secret-Token header never reaches any application
// logic, in particular never a database lookup of any kind.
//
// `:connectionId` in the URL is what deterministically routes an update to
// the right tenant/business (spec §20/§21) — it is set once, server-side,
// by telegramSetupService.ts's own setWebhook call; Telegram never chooses
// or is told this value by anyone else. Knowing a connectionId alone grants
// nothing without also presenting the correct secret header.
//
// No Conversation/Message logic is duplicated here (spec §15) — every
// update that passes the secret check is handed straight to the existing,
// unmodified receiveIncoming() pipeline exactly as api/channels/:id/inbound.ts
// already does.
// ============================================================================
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    // A safe, generic response — never a code/message that reveals whether
    // this URL corresponds to a real connection.
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    return
  }

  // ---- 1. Secret check FIRST — before any parameter parsing or DB read. --
  const provided = req.headers['x-telegram-bot-api-secret-token']
  const expected = env.telegramWebhookSecret
  const providedValue = typeof provided === 'string' ? provided : undefined
  if (!expected || !providedValue || !timingSafeEqualStrings(providedValue, expected)) {
    // Never logged (spec §16: "не логировать secret") — only the fact that
    // a rejection happened, never the header value itself.
    logger.warn('telegram_webhook_invalid_secret', { hasHeader: !!providedValue })
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } })
    return
  }

  // ---- 2. Resolve :connectionId → tenant/business — server-side only. ----
  const idResult = channelIdParamSchema.safeParse(req.query.connectionId)
  if (!idResult.success) {
    res.status(404).json({ error: { code: 'CHANNEL_NOT_FOUND', message: 'Channel connection not found' } })
    return
  }
  const connectionId = idResult.data

  const ctx = await resolveTelegramWebhookContext(connectionId)
  if (!ctx) {
    res.status(404).json({ error: { code: 'CHANNEL_NOT_FOUND', message: 'Channel connection not found' } })
    return
  }

  // ---- 3. Hand off to the existing, unmodified inbound pipeline. --------
  try {
    await receiveIncoming(ctx, connectionId, req.body)
  } catch (err) {
    // A classified ApiError (inactive connection, invalid/unsupported
    // payload, wrong channel type, etc.) is an expected, already-safe
    // outcome — retrying would never help, so Telegram is still ack'd with
    // 200 to stop it from redelivering the same update forever. Only a
    // genuinely UNEXPECTED failure (e.g. a database outage) is surfaced as
    // 500, so Telegram's own delivery retries get a chance to succeed once
    // this server recovers — there is no queue/background worker in this
    // codebase to fall back on otherwise (spec §28/§30 forbid one).
    if (err instanceof ApiError) {
      logger.info('telegram_webhook_processing_rejected', { code: err.code })
    } else {
      logger.error('telegram_webhook_processing_failed', { message: err instanceof Error ? err.message : 'unknown' })
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
      return
    }
  }

  // Spec §19: fast, minimal success response — never a Prisma object,
  // never any internal id (tenantId/businessId/customerId/conversationId),
  // never a secret, never a stack trace.
  res.status(200).json({ ok: true })
}
