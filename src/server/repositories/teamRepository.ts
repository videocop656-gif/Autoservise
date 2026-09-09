import type { Prisma, UserRole } from '@prisma/client'
import { Prisma as PrismaNamespace } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

/**
 * Thrown from inside a repository transaction when the caller asked for the
 * "at least one other active owner must remain" guard (`requireOtherActiveOwner`)
 * and that guard failed — the service layer is the only place that decides
 * WHEN to ask for the guard (that's the business rule); this repository only
 * knows how to enforce it atomically once asked (spec §16: repository never
 * decides who's allowed to do what).
 */
export class LastOwnerViolationError extends Error {}

// A named, explicitly-typed constant rather than an inline 'owner' literal —
// `withTenant`'s `T extends Record<string, unknown>` constraint otherwise
// widens an inline role literal to plain `string` during inference (the
// same TypeScript quirk documented in analyticsRepository.ts), which would
// break every enum-typed `where` clause below.
const OWNER_ROLE: UserRole = 'owner'

/** True for Postgres serialization failures Prisma surfaces as P2034 under Serializable isolation — a genuine concurrent-write conflict, not a business-rule violation. */
export function isSerializationConflict(err: unknown): boolean {
  return err instanceof PrismaNamespace.PrismaClientKnownRequestError && err.code === 'P2034'
}

interface OwnerGuardOpts {
  /**
   * When true, the transaction first counts OTHER active owners (this
   * business/tenant's `role: OWNER_ROLE, isActive: true` rows excluding the
   * target itself) and aborts with LastOwnerViolationError if that count is
   * 0 — real Postgres SERIALIZABLE isolation (not just a count-then-update)
   * is what makes this safe against two concurrent requests each demoting a
   * different one of exactly two remaining owners (classic write-skew;
   * REPEATABLE READ would let both succeed, SERIALIZABLE's predicate
   * locking forces one to abort with P2034 — see isSerializationConflict()).
   */
  requireOtherActiveOwner: boolean
}

export const teamRepository = {
  list(tenantId: string) {
    return prisma.user.findMany({ where: withTenant(tenantId), orderBy: [{ createdAt: 'asc' }] })
  },

  findById(tenantId: string, id: string) {
    return prisma.user.findFirst({ where: withTenant(tenantId, { id }) })
  },

  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } })
  },

  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data })
  },

  /** Plain profile fields only (name/email) — never role/isActive, enforced by the caller only ever passing a validated, whitelisted patch (teamService.ts). */
  async updateProfile(tenantId: string, id: string, data: Prisma.UserUpdateInput) {
    const result = await prisma.user.updateMany({ where: withTenant(tenantId, { id }), data })
    if (result.count === 0) return null
    return prisma.user.findFirst({ where: withTenant(tenantId, { id }) })
  },

  /** Race-safe role change: see OwnerGuardOpts. Returns null if the target row didn't match (wrong tenant/unknown id) — never distinguishable from "doesn't exist" to the caller, matching every other repository's 404 convention. */
  async changeRole(tenantId: string, id: string, role: UserRole, opts: OwnerGuardOpts) {
    return prisma.$transaction(
      async (tx) => {
        if (opts.requireOtherActiveOwner) {
          const others = await tx.user.count({ where: withTenant(tenantId, { role: OWNER_ROLE, isActive: true, id: { not: id } }) })
          if (others === 0) throw new LastOwnerViolationError()
        }
        const result = await tx.user.updateMany({ where: withTenant(tenantId, { id }), data: { role } })
        if (result.count === 0) return null
        return tx.user.findFirst({ where: withTenant(tenantId, { id }) })
      },
      opts.requireOtherActiveOwner ? { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable } : undefined
    )
  },

  /** Sets isActive=false AND deletes every session for that user, atomically — a deactivated row is never left with a still-valid session, even for an instant. See OwnerGuardOpts for the last-owner guard. */
  async deactivate(tenantId: string, id: string, opts: OwnerGuardOpts) {
    return prisma.$transaction(
      async (tx) => {
        if (opts.requireOtherActiveOwner) {
          const others = await tx.user.count({ where: withTenant(tenantId, { role: OWNER_ROLE, isActive: true, id: { not: id } }) })
          if (others === 0) throw new LastOwnerViolationError()
        }
        const result = await tx.user.updateMany({ where: withTenant(tenantId, { id }), data: { isActive: false } })
        if (result.count === 0) return null
        await tx.session.deleteMany({ where: { userId: id } })
        return tx.user.findFirst({ where: withTenant(tenantId, { id }) })
      },
      opts.requireOtherActiveOwner ? { isolationLevel: PrismaNamespace.TransactionIsolationLevel.Serializable } : undefined
    )
  },

  /** Never touches sessions — activation never creates one either (spec §11: the user signs in through the existing login flow). */
  async activate(tenantId: string, id: string) {
    const result = await prisma.user.updateMany({ where: withTenant(tenantId, { id }), data: { isActive: true } })
    if (result.count === 0) return null
    return prisma.user.findFirst({ where: withTenant(tenantId, { id }) })
  },

  countActiveOwners(tenantId: string, excludeId?: string) {
    return prisma.user.count({
      where: withTenant(tenantId, { role: OWNER_ROLE, isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) }),
    })
  },
}
