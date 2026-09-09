import type { AuthContext } from '../types/auth'
import { channelConnectionRepository } from '../repositories/channelConnectionRepository'
import { tenantRepository } from '../repositories/tenantRepository'
import { businessRepository } from '../repositories/businessRepository'

/**
 * Resolves the tenant/business context for an incoming Telegram webhook
 * request, purely from the `:connectionId` segment of the webhook URL
 * (Prompt 18 spec §20/§22) — this route has no session cookie at all
 * (Telegram calls it directly, authenticated only by the shared secret
 * header checked before this is ever called), so there is no
 * `requireAuth()`-produced `AuthContext` to reuse.
 *
 * `ctx.user` here is a synthetic, never-persisted placeholder — not a real
 * `User` row. This is safe specifically because the ENTIRE inbound pipeline
 * this context is handed to (channelMessageService.ts's `receiveIncoming()`
 * → channelCustomerService.ts → channelInboundRepository.ts) never reads
 * `ctx.user.id`/`ctx.sessionId` for anything beyond the one `requireRole()`
 * check at the top of `receiveIncoming()`, which only inspects
 * `ctx.user.role` — nothing here is ever written to `Message`,
 * `Conversation`, `ChannelMessage`, or `CustomerChannelIdentity` (all of
 * which record the CUSTOMER as the sender, never a staff/system actor).
 * Verified by direct inspection of every function in that call chain (see
 * this prompt's Final Report, "Existing architecture reused").
 */
export async function resolveTelegramWebhookContext(connectionId: string): Promise<AuthContext | null> {
  const connection = await channelConnectionRepository.findByIdUnscoped(connectionId)
  if (!connection || connection.type !== 'TELEGRAM') {
    return null
  }

  const tenant = await tenantRepository.findById(connection.tenantId)
  if (!tenant) return null
  const business = await businessRepository.findFirstByTenant(connection.tenantId)
  if (!business || business.id !== connection.businessId) return null

  return {
    user: {
      id: 'telegram-webhook',
      tenantId: tenant.id,
      email: 'telegram-webhook@internal',
      name: 'Telegram Webhook',
      role: 'owner',
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    },
    tenant,
    business,
    sessionId: 'telegram-webhook',
  }
}
