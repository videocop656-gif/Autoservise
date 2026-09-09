import type { Prisma, ConversationStatus, ConversationChannel } from '@prisma/client'
import { prisma } from '../db/prisma'
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
        customerRequest: { select: { id: true, subject: true, status: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { channelDelivery: true } },
      },
    })
  },

  create(data: Prisma.ConversationUncheckedCreateInput) {
    return prisma.conversation.create({ data })
  },

  async updateById(tenantId: string, businessId: string, id: string, data: Prisma.ConversationUpdateInput) {
    const result = await prisma.conversation.updateMany({ where: withTenant(tenantId, { businessId, id }), data })
    if (result.count === 0) return null
    return prisma.conversation.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
