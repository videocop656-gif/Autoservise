import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const channelConnectionRepository = {
  list(tenantId: string, businessId: string) {
    return prisma.channelConnection.findMany({ where: withTenant(tenantId, { businessId }), orderBy: { createdAt: 'desc' } })
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  create(data: Prisma.ChannelConnectionUncheckedCreateInput) {
    return prisma.channelConnection.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ChannelConnectionUpdateInput) {
    const result = await prisma.channelConnection.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  async setStatus(tenantId: string, businessId: string, id: string, status: 'ACTIVE' | 'INACTIVE') {
    const result = await prisma.channelConnection.updateMany({ where: withTenant(tenantId, { businessId, id }), data: { status } })
    if (result.count === 0) return null
    return prisma.channelConnection.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Real Telegram Channel Integration (Prompt 18) — deliberately NOT
   * tenant-scoped. The Telegram webhook route has no session/tenant context
   * of its own (Telegram calls it directly, authenticated only by the
   * shared secret header); this is the ONE lookup that lets it resolve
   * which tenant/business a given `:connectionId` in the webhook URL
   * belongs to, before any tenant-scoped code runs. Every caller of this
   * function must independently verify the row's `type`/`status` before
   * trusting it — this function itself makes no authorization decision, it
   * only looks a row up by its own id (an unguessable UUID), gated by the
   * caller already having passed the webhook secret check first.
   */
  findByIdUnscoped(id: string) {
    return prisma.channelConnection.findUnique({ where: { id } })
  },

  /**
   * Cross-tenant by design (Prompt 18) — the defensive guard
   * telegramSetupService.ts uses before registering a webhook: this
   * deployment supports exactly one real Telegram bot token
   * (`TELEGRAM_BOT_TOKEN`, see env.ts's own doc comment), so two DIFFERENT
   * tenants' ChannelConnection rows could otherwise both resolve to the
   * SAME underlying bot and silently steal each other's webhook
   * registration. Returns only enough to decide whether setup should be
   * refused — never exposed to any client, and the caller never reveals
   * which OTHER tenant holds it (spec: a generic "already connected
   * elsewhere" message only).
   */
  findOtherActiveByTypeAndExternalAccountId(type: 'TELEGRAM', externalAccountId: string, excludeConnectionId: string) {
    return prisma.channelConnection.findFirst({
      where: { type, externalAccountId, status: 'ACTIVE', id: { not: excludeConnectionId } },
      select: { id: true },
    })
  },
}
