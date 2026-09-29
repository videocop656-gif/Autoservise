import { Prisma, type ConversationStatus, type ConversationChannel } from '@prisma/client'
import { prisma } from '../db/prisma'
import type { DbClient } from '../db/transaction'
import { withTenant } from '../lib/tenantScope'

interface ListOptions {
  status?: ConversationStatus
  channel?: ConversationChannel
  customerId?: string
  customerRequestId?: string
  search?: string
  skip: number
  take: number
}

function buildSearchOr(search: string): NonNullable<Prisma.ConversationWhereInput['OR']> {
  return [{ subject: { contains: search, mode: 'insensitive' } }]
}

export const conversationRepository = {
  async list(tenantId: string, businessId: string, opts: ListOptions) {
    const where = withTenant(tenantId, {
      businessId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.channel ? { channel: opts.channel } : {}),
      ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.customerRequestId ? { customerRequestId: opts.customerRequestId } : {}),
      ...(opts.search ? { OR: buildSearchOr(opts.search) } : {}),
    })
    const [items, total] = await Promise.all([
      // Most recently active first; conversations with no messages yet
      // (lastMessageAt: null) sort after every conversation that has one,
      // never crashing or scattering nulls unpredictably — see spec §23.
      prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.conversation.count({ where }),
    ])
    return { items, total }
  },

  findById(tenantId: string, businessId: string, id: string) {
    return prisma.conversation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /** Channel Integration Foundation (Prompt 16) — the lookup channelConversationService.ts uses to find "the existing Conversation for this external thread" before deciding whether to create a new one. Relies on Conversation's own `@@unique([channelConnectionId, externalConversationId])`. */
  findByChannelConnectionAndExternalId(tenantId: string, businessId: string, channelConnectionId: string, externalConversationId: string) {
    return prisma.conversation.findFirst({
      where: withTenant(tenantId, { businessId, channelConnectionId, externalConversationId }),
    })
  },

  /**
   * Used by GET single — includes Customer/CustomerRequest summaries and the
   * full message list, oldest first (spec §24). Each message's `channelDelivery`
   * (Prompt 17) is included too, at most one per message by construction —
   * dto.ts's toMessageDto() only surfaces it when actually present.
   */
  findByIdWithDetail(tenantId: string, businessId: string, id: string) {
    return prisma.conversation.findFirst({
      where: withTenant(tenantId, { businessId, id }),
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        // Prompt 49 — vehicleId/serviceId/createdAt feed the «Обращение создано»
        // card; read straight from the relation, so it never depends on a
        // capped reference list on the client.
        customerRequest: { select: { id: true, subject: true, status: true, vehicleId: true, serviceId: true, createdAt: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { channelDelivery: true } },
      },
    })
  },

  create(data: Prisma.ConversationUncheckedCreateInput) {
    return prisma.conversation.create({ data })
  },

  // `db` (Prompt 49): pass a transaction client so the conversation link
  // commits or rolls back together with the CustomerRequest it points to.
  // updateMany only takes scalar fields, so the type is the unchecked
  // (scalar FK) input — the previous checked relational type accepted
  // relation writes (connect) that would fail at runtime (Prompt 49).
  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ConversationUncheckedUpdateManyInput, db: DbClient = prisma) {
    const result = await db.conversation.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return db.conversation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },

  /**
   * Prompt 49 — reads one conversation and takes a PostgreSQL row lock on it
   * (SELECT … FOR UPDATE) for the rest of the caller's transaction, so
   * concurrent "Создать обращение" calls for the same conversation queue here
   * and see each other's result. Tenant/business scoped: a foreign id locks
   * nothing and returns null. Must be called with a transaction client.
   */
  async findByIdForUpdate(tenantId: string, businessId: string, id: string, tx: Prisma.TransactionClient) {
    const locked = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "conversations" WHERE "id" = ${id} AND "tenantId" = ${tenantId} AND "businessId" = ${businessId} FOR UPDATE`
    )
    if (locked.length === 0) return null
    return tx.conversation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
