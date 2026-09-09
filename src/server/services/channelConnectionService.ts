import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { env } from '../lib/env'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { sanitizeChannelConfig } from '../channels/sanitizeChannelConfig'
import { bestEffortDeleteTelegramWebhook } from './telegramSetupService'
import type { CreateChannelConnectionInput, UpdateChannelConnectionInput } from '../validation/channel.schemas'

// Spec §"PERMISSIONS": owner and admin both get full operational access
// (create/edit/activate/deactivate) — the same "day-to-day operations, not
// a Settings-only change" exception already established for Appointment/
// Conversation/Escalations/AI Logs; manager is read-only, enforced here
// (never just hidden in the UI).
const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const
const MANAGING_ROLES = ['owner', 'admin'] as const

async function resolveConnection(ctx: AuthContext, id: string) {
  const connection = await channelConnectionRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!connection) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  return connection
}

export async function listChannelConnections(ctx: AuthContext) {
  requireRole(ctx, ...ANY_STAFF_ROLE)
  return channelConnectionRepository.list(ctx.tenant.id, ctx.business.id)
}

export async function getChannelConnection(ctx: AuthContext, id: string) {
  requireRole(ctx, ...ANY_STAFF_ROLE)
  return resolveConnection(ctx, id)
}

/** Always created INACTIVE (spec §"CHANNEL CREATE") — an explicit activate is always required before any inbound/outbound processing is possible. */
export async function createChannelConnection(ctx: AuthContext, input: CreateChannelConnectionInput) {
  requireRole(ctx, ...MANAGING_ROLES)

  try {
    return await channelConnectionRepository.create({
      tenantId: ctx.tenant.id,
      businessId: ctx.business.id,
      type: input.type,
      status: 'INACTIVE',
      displayName: input.displayName,
      externalAccountId: input.externalAccountId,
      config: sanitizeChannelConfig(input.config),
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'CHANNEL_ALREADY_EXISTS', 'A connection for this account already exists')
    }
    throw err
  }
}

/** Profile fields only — displayName/externalAccountId/config. Status changes exclusively through activate/deactivate below (spec §"CHANNEL PATCH"). */
export async function updateChannelConnection(ctx: AuthContext, id: string, input: UpdateChannelConnectionInput) {
  requireRole(ctx, ...MANAGING_ROLES)
  await resolveConnection(ctx, id)

  try {
    const updated = await channelConnectionRepository.updateById(ctx.tenant.id, ctx.business.id, id, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.externalAccountId !== undefined ? { externalAccountId: input.externalAccountId } : {}),
      ...(input.config !== undefined ? { config: sanitizeChannelConfig(input.config) ?? Prisma.JsonNull } : {}),
    })
    if (!updated) {
      throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    }
    return updated
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'CHANNEL_ALREADY_EXISTS', 'A connection for this account already exists')
    }
    throw err
  }
}

/**
 * Real Telegram Channel Integration (Prompt 18 spec §33): "нельзя считать
 * реально подключённым только потому, что пользователь нажал Activate."
 * When a real Telegram bot token is actually configured on this server
 * (`env.telegramBotToken`), a TELEGRAM connection can ONLY become ACTIVE by
 * going through the full `/telegram/setup` verification flow
 * (telegramSetupService.ts) — getMe + setWebhook must both genuinely
 * succeed first. This endpoint's permission model is otherwise untouched
 * (spec: "должен сохранить существующую permission model").
 *
 * When NO real token is configured, this restriction does not apply at
 * all — the exact same "optional credential → mock-foundation behavior"
 * convention as channelAdapterRegistry.ts, which is why every pre-existing
 * test/foundation flow that activates a TELEGRAM connection directly (this
 * whole codebase's own test suite runs with no token configured) continues
 * to work completely unchanged.
 */
export async function activateChannelConnection(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  const connection = await resolveConnection(ctx, id)
  if (connection.type === 'TELEGRAM' && env.telegramBotToken) {
    throw new ApiError(409, 'TELEGRAM_SETUP_REQUIRED', 'Use the Telegram setup flow to activate this connection')
  }
  const updated = await channelConnectionRepository.setStatus(ctx.tenant.id, ctx.business.id, id, 'ACTIVE')
  if (!updated) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  return updated
}

/**
 * Deactivation never deletes anything (spec §"ACTIVATE / DEACTIVATE") —
 * Conversation/Message/ChannelMessage/CustomerChannelIdentity rows for
 * this connection are all left exactly as they are; only future inbound/
 * outbound processing through this connection is blocked
 * (channelMessageService.ts checks `status === 'ACTIVE'` itself).
 *
 * Prompt 18 spec §34: for a live Telegram connection, deactivation also
 * best-effort unregisters the webhook (`deleteWebhook`) — but this can
 * never be atomic with the database update (they're two different
 * systems), so a failure to reach Telegram never blocks or reverts the
 * deactivation itself. This is safe specifically because our own
 * webhook route independently re-checks `status === 'ACTIVE'` on every
 * request (via the existing `receiveIncoming()` → `resolveActiveConnection()`
 * check) — even if Telegram's remote registration somehow survives a
 * failed `deleteWebhook` call, this server will still reject/ignore
 * anything it delivers the instant the DB row is INACTIVE. The DB flag is
 * the authoritative, sole source of truth for whether this app processes
 * anything; `deleteWebhook` is pure best-effort remote cleanup.
 */
export async function deactivateChannelConnection(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  const connection = await resolveConnection(ctx, id)

  if (connection.type === 'TELEGRAM' && connection.status === 'ACTIVE' && env.telegramBotToken) {
    await bestEffortDeleteTelegramWebhook(env.telegramBotToken)
  }

  const updated = await channelConnectionRepository.setStatus(ctx.tenant.id, ctx.business.id, id, 'INACTIVE')
  if (!updated) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  return updated
}
