import type { Prisma, AiEscalationStatus, AiEscalationPriority } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

/** Statuses in which an escalation still needs human attention — mirrors AiEscalationStatus's OPEN/IN_PROGRESS pair used throughout escalationService.ts. */
export const ACTIVE_ESCALATION_STATUSES: AiEscalationStatus[] = ['OPEN', 'IN_PROGRESS']

interface ListOptions {
  status?: AiEscalationStatus
  priority?: AiEscalationPriority
  assignedUserId?: string
  unassignedOnly?: boolean
  customerId?: string
  conversationId?: string
  skip: number
  take: number
}

const DETAIL_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true } },
  assignedUser: { select: { id: true, name: true } },
  conversation: { select: { id: true, subject: true, status: true, channel: true } },
} satisfies Prisma.AiEscalationInclude

export const escalationRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.priority ? { priority: opts.priority } : {}),
      ...(opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {}),
      ...(opts.unassignedOnly ? { assignedUserId: null } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    })
    const [items, total] = await Promise.all([
      // Postgres orders an enum column by its CREATE TYPE declaration order
      // (LOW, NORMAL, HIGH, URGENT — see schema.prisma), so `desc` here
      // naturally yields URGENT > HIGH > NORMAL > LOW with zero
      // application-level custom sorting (spec §"STAFF LIST").
      prisma.aiEscalation.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.aiEscalation.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  findByIdWithDetail(tenantId: string, businessId: string, id: string) {
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, id }), include: DETAIL_INCLUDE })
  },

  /**
   * The idempotency fast path (spec §"ESCALATION UNIQUENESS"): reads the
   * one row (if any) currently holding this conversation active, via the
   * same `activeConversationId` column the database-level unique
   * constraint is built on — never a `status IN (...)` scan, so this stays
   * correct by construction as long as the column is kept in lockstep with
   * `status` (see create/resolve/cancel below).
   */
  findActiveByConversation(tenantId: string, businessId: string, conversationId: string) {
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, activeConversationId: conversationId }) })
  },

  create(data: Prisma.AiEscalationUncheckedCreateInput) {
    return prisma.aiEscalation.create({ data })
  },

  /**
   * Atomic claim (spec §"CLAIM"): the WHERE clause itself is the
   * concurrency guard — two managers calling this for the same escalation
   * at the same instant can never both succeed, because the second
   * `updateMany` simply matches zero rows once the first has already
   * flipped `assignedUserId` away from null. Returns null on no match; the
   * service layer re-reads to distinguish "already claimed by someone
   * else" from "not found" from "already mine" (idempotent).
   */
  async claim(tenantId: string, businessId: string, id: string, userId: string) {
    const result = await prisma.aiEscalation.updateMany({
      where: withTenant(tenantId, { businessId, id, status: 'OPEN' as AiEscalationStatus, assignedUserId: null }),
      data: { status: 'IN_PROGRESS', assignedUserId: userId },
    })
    if (result.count === 0) return null
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /** Only ever transitions from an active status (spec §"RESOLUTION") — resolvedAt is always server time, never client-supplied. */
  async resolve(tenantId: string, businessId: string, id: string) {
    const result = await prisma.aiEscalation.updateMany({
      where: withTenant(tenantId, { businessId, id, status: { in: ACTIVE_ESCALATION_STATUSES } }),
      data: { status: 'RESOLVED', resolvedAt: new Date(), activeConversationId: null },
    })
    if (result.count === 0) return null
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /** Deliberately does NOT set resolvedAt (spec §"CANCELLATION": resolvedAt means "actually resolved," not "closed for any reason"). */
  async cancel(tenantId: string, businessId: string, id: string) {
    const result = await prisma.aiEscalation.updateMany({
      where: withTenant(tenantId, { businessId, id, status: { in: ACTIVE_ESCALATION_STATUSES } }),
      data: { status: 'CANCELLED', activeConversationId: null },
    })
    if (result.count === 0) return null
    return prisma.aiEscalation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
