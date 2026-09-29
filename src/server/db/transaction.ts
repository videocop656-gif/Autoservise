import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Prompt 48.1 — either the global client or an interactive-transaction
 * client. Repository methods that can take part in a multi-step write
 * accept one of these (defaulting to the global client), so the same
 * repository code runs standalone or inside runInTransaction unchanged.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * Runs `fn` in one Prisma interactive transaction: every write made through
 * the `tx` it receives commits together, or — if `fn` throws — none of them
 * does. Same mechanism the repositories already use internally
 * (prisma.$transaction(async (tx) => ...)), lifted to the service layer for
 * operations that span more than one repository.
 *
 * The timeouts are more generous than Prisma's defaults (2 s / 5 s) because
 * a transaction may wait on a row lock held by a concurrent request (see
 * serviceFollowUpRepository.findByIdForUpdate) and the database is remote.
 */
export function runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { maxWait: 10_000, timeout: 20_000 })
}
