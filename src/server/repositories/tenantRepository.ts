import { prisma } from '../db/prisma'

export const tenantRepository = {
  findById(id: string) {
    return prisma.tenant.findUnique({ where: { id } })
  },
}
