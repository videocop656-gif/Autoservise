import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
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
  create(data: Prisma.CustomerUncheckedCreateInput) {
    return prisma.customer.create({ data })
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
   * Channel Integration Foundation (Prompt 16) — spec §"CUSTOMER
   * RESOLUTION": "попытаться найти Customer по нормализованному телефону".
   * `Customer.phone` is stored free-form (see customer.schemas.ts — no
   * canonical format is enforced at write time), so an exact string match
   * against an inbound channel's own phone formatting would miss almost
   * every real match. This compares the LAST 10 DIGITS only (Postgres's
   * built-in `regexp_replace`/`right`, no extension needed) — a
   * deliberately simple heuristic ("last 10 digits" = the local subscriber
   * number), robust to +7/8/00/no-prefix country-code variance without
   * pulling in a full phone-number-parsing library or a "сложный CRM
   * dedup engine" the spec explicitly says not to build. `localNumber`
   * must already be normalized the same way by the caller
   * (channelCustomerService.ts's localSubscriberNumber()) before this is
   * called. Returns every match — the caller (not this repository) decides
   * what "exactly one" means, matching spec §16's repository/service split.
   */
  findActiveByLocalPhoneNumber(tenantId: string, businessId: string, localNumber: string): Promise<{ id: string }[]> {
    // The regex must be written as '\\D' (double backslash) in this JS
    // template literal — `\D` alone is silently reduced to just `D` by
    // JS's own escape-sequence handling (confirmed live: `` `\D` === 'D' ``,
    // 1 character, backslash dropped), which would send Postgres a regex
    // matching the literal letter "D" instead of "non-digit character" —
    // exactly the bug that made this function silently match nothing
    // real (found live against Supabase before being caught here).
    return prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers
      WHERE "tenantId" = ${tenantId} AND "businessId" = ${businessId} AND "isActive" = true
        AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ${localNumber}
    `
  },
}
