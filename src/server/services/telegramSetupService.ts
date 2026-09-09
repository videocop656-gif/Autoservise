import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { env } from '../lib/env'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { sanitizeChannelConfig } from '../channels/sanitizeChannelConfig'
import { telegramApiClient, TelegramApiError } from '../channels/adapters/telegram/telegramApiClient'

const MANAGING_ROLES = ['owner', 'admin'] as const

/** Maps a TelegramApiError (or any other thrown error) to a safe ApiError — never the raw Telegram description, never the token. */
function toSafeApiError(err: unknown, fallbackMessage: string): ApiError {
  if (err instanceof TelegramApiError) {
    return new ApiError(502, err.code, err.message)
  }
  return new ApiError(502, 'TELEGRAM_PROVIDER_ERROR', fallbackMessage)
}

/**
 * Best-effort webhook cleanup on deactivation (Prompt 18 spec §34) — called
 * from channelConnectionService.ts's `deactivateChannelConnection()`. Never
 * throws: a failure to reach Telegram must never block or roll back the
 * deactivation itself (see that function's own doc comment for the full
 * reasoning). Logging is intentionally left to the caller's own judgment —
 * this function's contract is simply "try, and never propagate a failure."
 */
export async function bestEffortDeleteTelegramWebhook(token: string): Promise<void> {
  try {
    await telegramApiClient.deleteWebhook(token)
  } catch {
    // Deliberately swallowed — see this function's own doc comment above.
  }
}

/**
 * Real Telegram Channel Integration (Prompt 18 spec §32) — the only path
 * that can ever bring a TELEGRAM ChannelConnection to ACTIVE when a real
 * bot token is configured (channelConnectionService.ts's own
 * `activateChannelConnection()` refuses TELEGRAM in that case). Never
 * activates on partial success (spec: "Не активировать connection, если:
 * token invalid; getMe failed; setWebhook failed").
 *
 * Pipeline: verify ownership/type → resolve the server-side bot token →
 * getMe (confirms the token is valid, returns the bot's own immutable
 * numeric id) → refuse if this exact bot is already the active Telegram
 * connection for a DIFFERENT tenant (this deployment supports exactly one
 * real bot token today — see channelConnectionRepository.ts's own doc
 * comment on why this guard exists) → persist the real externalAccountId +
 * a safe display username → setWebhook against this connection's own
 * unguessable webhook URL, secured by the shared secret token → only now,
 * flip the connection to ACTIVE.
 */
export async function setupTelegramConnection(ctx: AuthContext, connectionId: string) {
  requireRole(ctx, ...MANAGING_ROLES)

  const connection = await channelConnectionRepository.findById(ctx.tenant.id, ctx.business.id, connectionId)
  if (!connection) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  if (connection.type !== 'TELEGRAM') {
    throw new ApiError(409, 'CHANNEL_TYPE_MISMATCH', 'This connection is not a Telegram connection')
  }

  const token = env.telegramBotToken
  if (!token) {
    throw new ApiError(503, 'CHANNEL_CONFIGURATION_ERROR', 'Telegram integration is not configured on this server')
  }
  const webhookSecret = env.telegramWebhookSecret
  if (!webhookSecret) {
    throw new ApiError(503, 'CHANNEL_CONFIGURATION_ERROR', 'Telegram webhook secret is not configured on this server')
  }

  let me
  try {
    me = await telegramApiClient.getMe(token)
  } catch (err) {
    throw toSafeApiError(err, 'Could not verify the Telegram bot token')
  }
  const botId = String(me.id)

  const conflict = await channelConnectionRepository.findOtherActiveByTypeAndExternalAccountId('TELEGRAM', botId, connectionId)
  if (conflict) {
    throw new ApiError(409, 'CHANNEL_ALREADY_EXISTS', 'This Telegram bot is already connected to another workspace')
  }

  // Spec §37: server-side base URL only, never a client-supplied one — and
  // Telegram itself requires a public HTTPS URL, so a non-HTTPS APP_URL
  // (e.g. the local dev default) is rejected here with a clear, actionable
  // message rather than a confusing failure from Telegram's own API.
  if (!env.appUrl.startsWith('https://')) {
    throw new ApiError(
      503,
      'CHANNEL_CONFIGURATION_ERROR',
      'APP_URL must be a public HTTPS URL for Telegram webhooks (local development requires a public HTTPS tunnel — see docs)'
    )
  }
  const webhookUrl = `${env.appUrl}/api/webhooks/telegram/${connectionId}`

  try {
    await telegramApiClient.setWebhook(token, webhookUrl, webhookSecret)
  } catch (err) {
    throw toSafeApiError(err, 'Could not register the Telegram webhook')
  }

  const existingConfig = (connection.config as Record<string, unknown> | null) ?? {}
  const updated = await channelConnectionRepository.updateById(ctx.tenant.id, ctx.business.id, connectionId, {
    externalAccountId: botId,
    config: sanitizeChannelConfig({ ...existingConfig, ...(me.username ? { telegramUsername: me.username } : {}) }) ?? Prisma.JsonNull,
  })
  if (!updated) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }

  const activated = await channelConnectionRepository.setStatus(ctx.tenant.id, ctx.business.id, connectionId, 'ACTIVE')
  if (!activated) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }

  return { connection: activated, botUsername: me.username ?? null }
}
