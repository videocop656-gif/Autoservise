import { prisma } from '../db/prisma'

export const userRepository = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } })
  },
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } })
  },
}
