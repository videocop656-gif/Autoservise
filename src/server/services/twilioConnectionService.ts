import { Prisma } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { assignedTwilioSender, TWILIO_PROVIDER } from '../channels/whatsappTransport'

// ---------------------------------------------------------------------------
// MCR-7B1 — the controlled way to put an already provisioned Twilio WhatsApp
// sender on a business's WhatsApp ChannelConnection (pilot; MCR-7B2 replaces
// this with Embedded Signup). The client never names a number: the server
// takes the ONE sender assigned to the caller's own business in
// TWILIO_WHATSAPP_SENDERS. Owner/admin only. The unique routingKey makes it
// impossible for one live sender to route to two businesses.
// ---------------------------------------------------------------------------

const MANAGING_ROLES = ['owner', 'admin'] as const

async function whatsappConnection(ctx: AuthContext, id: string) {
  const connection = await channelConnectionRepository.findById(ctx.tenant.id, ctx.business.id, id)
  if (!connection) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  if (connection.type !== 'WHATSAPP') throw new ApiError(409, 'CHANNEL_TYPE_MISMATCH', 'Twilio подключается только к каналу WhatsApp')
  return connection
}

export async function connectTwilioSender(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  await whatsappConnection(ctx, id)
  const sender = assignedTwilioSender(ctx.business.id)
  if (!sender) throw new ApiError(409, 'NO_ASSIGNED_SENDER', 'Для вашего автосервиса не назначен номер WhatsApp в Twilio')
  try {
    const updated = await channelConnectionRepository.setProviderSender(ctx.tenant.id, ctx.business.id, id, { provider: TWILIO_PROVIDER, senderE164: sender })
    if (!updated) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
    return updated
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'SENDER_ALREADY_CONNECTED', 'Этот номер WhatsApp уже подключён к другому каналу')
    }
    throw err
  }
}

export async function disconnectTwilioSender(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  await whatsappConnection(ctx, id)
  const updated = await channelConnectionRepository.setProviderSender(ctx.tenant.id, ctx.business.id, id, { provider: null, senderE164: null })
  if (!updated) throw new ApiError(404, 'CHANNEL_NOT_FOUND', 'Channel connection not found')
  return updated
}
