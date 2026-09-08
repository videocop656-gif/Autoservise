import type { Prisma, AiLogOperation, AiLogOutcome } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  operation?: AiLogOperation
  outcome?: AiLogOutcome
  conversationId?: string
  escalationId?: string
  dateFrom?: Date
  dateTo?: Date
  skip: number
  take: number
}

const DETAIL_INCLUDE = {
  actorUser: { select: { id: true, name: true } },
} satisfies Prisma.AiLogInclude

export const aiLogRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.operation ? { operation: opts.operation } : {}),
      ...(opts.outcome ? { outcome: opts.outcome } : {}),
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
      ...(opts.escalationId ? { escalationId: opts.escalationId } : {}),
      ...(opts.dateFrom || opts.dateTo
        ? {
            createdAt: {
              ...(opts.dateFrom ? { gte: opts.dateFrom } : {}),
              ...(opts.dateTo ? { lt: opts.dateTo } : {}),
            },
          }
        : {}),
    })
    const [items, total] = await Promise.all([
      // Server-generated createdAt, never client input (spec §"AUDIT
      // ORDER") — id DESC as a deterministic tie-breaker for rows created
      // in the same millisecond.
      prisma.aiLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.aiLog.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.aiLog.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /** Used by GET single — includes the actor (staff member) summary (spec §"DETAIL"). */
  findByIdWithDetail(tenantId: string, businessId: string, id: string) {
    return prisma.aiLog.findFirst({ where: withTenant(tenantId, { businessId, id }), include: DETAIL_INCLUDE })
  },

  /** The only write path — always called from aiLogService.ts, never with client-supplied tenantId/businessId/createdAt. */
  create(data: Prisma.AiLogUncheckedCreateInput) {
    return prisma.aiLog.create({ data })
  },
}
