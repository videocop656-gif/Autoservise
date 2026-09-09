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
  /** Team Management (Prompt 15): revokes every active session for a user in one shot — called from within deactivateTeamMember()'s transaction, so it never leaves a session dangling for a user that was just marked inactive. */
  deleteByUserId(userId: string) {
    return prisma.session.deleteMany({ where: { userId } })
  },
}
