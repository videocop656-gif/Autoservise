import { prisma } from '../db/prisma'

export const sessionRepository = {
  create(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.session.create({ data: { userId, tokenHash, expiresAt } })
  },
  findByTokenHash(tokenHash: string) {
    return prisma.session.findUnique({ where: { tokenHash } })
  },
  touch(id: string) {
    return prisma.session.update({ where: { id }, data: { lastUsedAt: new Date() } })
  },
  deleteByTokenHash(tokenHash: string) {
    return prisma.session.deleteMany({ where: { tokenHash } })
  },
}
