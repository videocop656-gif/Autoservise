import { Prisma, type CallEventType } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// MCR-2 — call interactions and their provider-event ledger. Every write takes
// the caller's transaction: callIntakeService runs one short transaction per
// webhook event (insert-if-absent → row lock → event insert-if-absent → state
// update), so concurrent deliveries for one call apply one at a time and a
// redelivered event is a no-op.

export const callInteractionRepository = {
  /**
   * INSERT … ON CONFLICT DO NOTHING on (provider, providerCallId): the first
   * event of a call creates its record, every later or concurrent one finds
   * it. Never fails on the duplicate (unlike create(), it doesn't abort the
   * surrounding Postgres transaction).
   */
  async insertIfAbsent(data: Prisma.CallInteractionCreateManyInput, tx: Prisma.TransactionClient): Promise<void> {
    await tx.callInteraction.createMany({ data: [data], skipDuplicates: true })
  },

  /** Locks the call's row (SELECT … FOR UPDATE) for the rest of the transaction and returns it. */
  async lockByProviderCall(provider: string, providerCallId: string, tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "call_interactions" WHERE "provider" = ${provider} AND "providerCallId" = ${providerCallId} FOR UPDATE`
    )
    if (!rows[0]) return null
    return tx.callInteraction.findUnique({ where: { id: rows[0].id } })
  },

  /**
   * Records one provider event exactly once (unique (provider,
   * providerEventId), ON CONFLICT DO NOTHING). Returns false for a
   * redelivery — the caller then applies nothing.
   */
  async insertEventIfAbsent(
    data: {
      tenantId: string
      businessId: string
      callInteractionId: string
      provider: string
      providerEventId: string
      eventType: CallEventType
      occurredAt: Date | null
      receivedAt: Date
    },
    tx: Prisma.TransactionClient
  ): Promise<boolean> {
    const result = await tx.callEvent.createMany({ data: [data], skipDuplicates: true })
    return result.count === 1
  },

  update(id: string, data: Prisma.CallInteractionUpdateInput, tx: Prisma.TransactionClient) {
    return tx.callInteraction.update({ where: { id }, data })
  },

  /** Tenant-scoped read (verification / future operator views). */
  findById(tenantId: string, businessId: string, id: string) {
    return prisma.callInteraction.findFirst({ where: withTenant(tenantId, { businessId, id }) })
  },
}
