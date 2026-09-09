import type { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

export const customerChannelIdentityRepository = {
  /**
   * Always scoped by channelConnectionId (spec §"CUSTOMER IDENTITY
   * SECURITY") — never looked up by externalCustomerId alone, so the same
   * raw external id from a different connection/business/tenant can never
   * collide with this one.
   */
  findByConnectionAndExternalCustomerId(tenantId: string, businessId: string, channelConnectionId: string, externalCustomerId: string) {
    return prisma.customerChannelIdentity.findFirst({
      where: withTenant(tenantId, { businessId, channelConnectionId, externalCustomerId }),
    })
  },

  create(data: Prisma.CustomerChannelIdentityUncheckedCreateInput) {
    return prisma.customerChannelIdentity.create({ data })
  },
}
