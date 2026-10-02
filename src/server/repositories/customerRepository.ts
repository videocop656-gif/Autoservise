import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { DbClient } from '../db/transaction'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  activeOnly: boolean
  search?: string
  skip: number
  take: number
}

function buildSearchOr(search: string): NonNullable<Prisma.CustomerWhereInput['OR']> {
  return [
    { firstName: { contains: search, mode: 'insensitive' } },
    { lastName: { contains: search, mode: 'insensitive' } },
    { phone: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ]
}

export const customerRepository = {
  async list(tenantId: string, businessId: string, { activeOnly, search, skip, take }: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(activeOnly ? { isActive: true } : {}),
      ...(search ? { OR: buildSearchOr(search) } : {}),
    })
    const [items, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.customer.count({ where }),
    ])
    return { items, total }
  },
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.customer.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  /** Used for duplicate-email protection at creation/update; excludeId lets an update ignore its own row. */
  findActiveByEmail(tenantId: string, businessId: string, email: string, excludeId?: string) {
    return prisma.customer.findFirst({
      where: withTenant(tenantId, {
        businessId,
        email,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      }),
    })
  },
  // `db` (Prompt 54): a transaction client, so a customer created from a
  // conversation commits together with the conversation link.
  create(data: Prisma.CustomerUncheckedCreateInput, db: DbClient = prisma) {
    return db.customer.create({ data })
  },
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.CustomerUpdateInput) {
    const result = await prisma.customer.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.customer.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
  async deactivate(tenantId: string, businessId: string, id: string): Promise<number> {
    const result = await prisma.customer.updateMany({
      where: withTenant(tenantId, { businessId, id }),
      data: { isActive: false },
    })
    return result.count
  },

  /**
   * MCR-1 — every active customer of this business whose canonical phone
   * (Customer.phoneE164, see src/server/lib/phone.ts) equals `phoneE164`.
   * An indexed equality lookup (customers_tenantId_businessId_phoneE164_idx)
   * that replaces Prompt 16's last-10-digits regex scan over free-form
   * `phone`. `phoneE164` must already be normalized by the caller
   * (normalizePhone). Returns every match — the caller (not this
   * repository) decides what "exactly one" means.
   */
  findActiveByPhoneE164(tenantId: string, businessId: string, phoneE164: string): Promise<{ id: string }[]> {
    return prisma.customer.findMany({
      where: withTenant(tenantId, { businessId, isActive: true, phoneE164 }),
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
  },
}
