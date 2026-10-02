import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// MCR-2 — business phone numbers (telephony routing identity). The only code
// that writes activePhoneE164, always in lockstep with isActive (the
// database CHECK business_phone_numbers_active_mirror enforces the same).

/** True for the unique-violation on activePhoneE164 (number already active somewhere). */
export function isActiveNumberConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export const businessPhoneNumberRepository = {
  listByBusiness(tenantId: string, businessId: string) {
    return prisma.businessPhoneNumber.findMany({
      where: withTenant(tenantId, { businessId }),
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    })
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.businessPhoneNumber.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Telephony routing: the ONE active number equal to `phoneE164`, across all
   * tenants (activePhoneE164 is globally unique), or null. Deliberately
   * unscoped — the webhook doesn't know the tenant yet; this lookup is what
   * determines it. Callers must never take tenant/business from elsewhere.
   */
  findActiveByPhoneE164ForRouting(phoneE164: string) {
    return prisma.businessPhoneNumber.findUnique({ where: { activePhoneE164: phoneE164 } })
  },

  /** Throws P2002 (see isActiveNumberConflict) if the number is already active anywhere. */
  create(data: { tenantId: string; businessId: string; phoneE164: string; label: string | null }) {
    return prisma.businessPhoneNumber.create({
      data: { ...data, isActive: true, activePhoneE164: data.phoneE164 },
    })
  },

  /** Activation throws P2002 if another business holds the number actively meanwhile. */
  async setActive(tenantId: string, businessId: string, id: string, isActive: boolean) {
    const existing = await prisma.businessPhoneNumber.findFirst({ where: withTenant(tenantId, { businessId, id }) })
    if (!existing) return null
    const result = await prisma.businessPhoneNumber.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive, activePhoneE164: isActive ? existing.phoneE164 : null },
    })
    if (result.count === 0) return null
    return prisma.businessPhoneNumber.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
