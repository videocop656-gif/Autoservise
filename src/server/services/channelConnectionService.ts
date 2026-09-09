import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import type { CreateChannelConnectionInput, UpdateChannelConnectionInput } from '../validation/channel.schemas'

// Spec §"PERMISSIONS": owner and admin both get full operational access
// (create/edit/activate/deactivate) — the same "day-to-day operations, not
// a Settings-only change" exception already established for Appointment/
// Conversation/Escalations/AI Logs; manager is read-only, enforced here
// (never just hidden in the UI).
const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const
const MANAGING_ROLES = ['owner', 'admin'] as const

// Blacklist, not whitelist — unlike aiLogService.ts's metadata (a fixed,
// known-safe set of keys this codebase itself writes), `config` here is
// meant to hold whatever small, non-secret per-channel settings a real
// adapter eventually needs, which this foundation stage can't fully
// enumerate in advance. So instead: strip anything key-shaped like a
// credential, and only ever keep primitive values (never nested objects —
// see channel.schemas.ts's channelConfigSchema, which already enforces
// this structurally; this is the second, independent layer) — spec
// §"CONFIG": bot token/API key/OAuth token/refresh token/webhook secret/
// password must never be stored here, in any form.
const SECRET_LOOKING_KEY = /token|secret|key|password|credential|auth/i
const MAX_CONFIG_VALUE_LENGTH = 500

function sanitizeChannelConfig(config: Record<string, unknown> | undefined | null): Prisma.InputJsonObject | undefined {
  if (!config) return undefined
  const safe: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_LOOKING_KEY.test(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_CONFIG_VALUE_LENGTH)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value
    }
    // objects/arrays are silently dropped — never nested, never a place to hide a structured secret.
  }
  return Object.keys(safe).length > 0 ? (safe as Prisma.InputJsonObject) : undefined
}

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

export async function activateChannelConnection(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  await resolveConnection(ctx, id)
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
 */
export async function deactivateChannelConnection(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  await resolveConnection(ctx, id)
  const updated = await channelConnectionRepository.setStatus(ctx.tenant.id, ctx.business.id, id, 'INACTIVE')
  if (!updated) {
    throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  }
  return updated
}
