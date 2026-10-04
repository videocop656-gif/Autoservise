import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// MCR-8A — a business's telephony-provider connection (one row per business +
// provider). Holds no secret: the provider's webhook secret lives in server
// configuration (pilot) and is resolved before this row is read.

export const telephonyConnectionRepository = {
  findByBusiness(tenantId: string, businessId: string, provider: string) {
    return prisma.telephonyConnection.findFirst({ where: withTenant(tenantId, { businessId, provider }) })
  },

  /**
   * Webhook path: the ACTIVE connection of the business a verified provider
   * secret belongs to. Unscoped by tenant on purpose — the business id comes
   * from server configuration (never from the request), and the row itself
   * yields the tenant.
   */
  findActiveForWebhook(businessId: string, provider: string) {
    return prisma.telephonyConnection.findFirst({ where: { businessId, provider, status: 'ACTIVE' } })
  },

  activate(tenantId: string, businessId: string, provider: string, at: Date) {
    return prisma.telephonyConnection.upsert({
      where: { businessId_provider: { businessId, provider } },
      create: { tenantId, businessId, provider, status: 'ACTIVE', connectedAt: at },
      update: { status: 'ACTIVE', connectedAt: at, disabledAt: null },
    })
  },

  async disable(tenantId: string, businessId: string, provider: string, at: Date) {
    await prisma.telephonyConnection.updateMany({ where: withTenant(tenantId, { businessId, provider }), data: { status: 'DISABLED', disabledAt: at } })
    return prisma.telephonyConnection.findFirst({ where: withTenant(tenantId, { businessId, provider }) })
  },
}
