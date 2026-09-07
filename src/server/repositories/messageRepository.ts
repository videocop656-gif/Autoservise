import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const messageRepository = {
  /**
   * All messages of one conversation, oldest first (spec §11). Not
   * paginated at this stage — see spec §25, a deliberate, documented
   * simplification (this project's other "child collection" endpoints are
   * all paginated, but a conversation's message count is expected to stay
   * small while there is no live channel feeding it).
   */
  listByConversation(tenantId: string, businessId: string, conversationId: string) {
    return prisma.message.findMany({
      where: withTenant(tenantId, { businessId, conversationId }),
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * Atomically creates the Message and updates the parent Conversation's
   * lastMessageAt to the message's own createdAt — an interactive Prisma
   * transaction (same pattern introduced in Prompt 07 for CustomerRequest +
   * its status history) so the two can never drift apart under concurrent
   * writes (spec §18, §22). The conversation update is tenant-scoped
   * exactly like updateById; a foreign-tenant conversationId would already
   * have been rejected by the service layer's own lookup before this is
   * ever called.
   */
  createAndTouchConversation(tenantId: string, businessId: string, data: Prisma.MessageUncheckedCreateInput) {
    return prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data })
      await tx.conversation.updateMany({
        where: withTenant(tenantId, { businessId, id: data.conversationId }),
        data: { lastMessageAt: message.createdAt },
      })
      return message
    })
  },
}
