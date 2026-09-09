import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const channelMessageRepository = {
  /** The DB-level idempotency check (spec §"IDEMPOTENCY OF INCOMING MESSAGES") — scoped to the specific connection, never just externalMessageId alone (which could collide across unrelated connections). */
  findByConnectionAndExternalMessageId(tenantId: string, businessId: string, channelConnectionId: string, externalMessageId: string) {
    return prisma.channelMessage.findFirst({
      where: withTenant(tenantId, { businessId, channelConnectionId, externalMessageId }),
    })
  },

  create(data: Prisma.ChannelMessageUncheckedCreateInput) {
    return prisma.channelMessage.create({ data })
  },
}
