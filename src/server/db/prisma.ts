import { PrismaClient } from '@prisma/client'

// Reuse a single PrismaClient across hot-reloads in development so we don't
// exhaust the database connection pool by creating a new client per reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
