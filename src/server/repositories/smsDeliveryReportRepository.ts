import { Prisma, type ProviderDeliveryState } from '@prisma/client'
import { prisma } from '../db/prisma'
import { runInTransaction } from '../db/transaction'

// ---------------------------------------------------------------------------
// MCR-7A — persistence for provider delivery reports. The webhook has no
// tenant: a report finds its row ONLY by (provider, provider message id) we
// stored when the provider accepted the message. Event idempotency is a
// unique (provider, eventId) row written in the same transaction as the
// state change.
// ---------------------------------------------------------------------------

export const smsDeliveryReportRepository = {
  findEvent(provider: string, eventId: string) {
    return prisma.providerWebhookEvent.findUnique({ where: { provider_eventId: { provider, eventId } } })
  },

  /** The delivery a report is about, with the destination thread it was sent to (for the cross-check). */
  async findDelivery(provider: string, externalMessageId: string) {
    const delivery = await prisma.channelDelivery.findFirst({ where: { provider, externalMessageId } })
    if (!delivery) return null
    const message = await prisma.message.findUnique({ where: { id: delivery.messageId }, select: { conversationId: true } })
    const conversation = message ? await prisma.conversation.findUnique({ where: { id: message.conversationId }, select: { externalConversationId: true } }) : null
    return { delivery, destinationThread: conversation?.externalConversationId ?? null }
  },

  /** Records an event that changes no delivery. false = it was already recorded (duplicate). */
  async recordEvent(provider: string, eventId: string, outcome: string, channelDeliveryId: string | null = null): Promise<boolean> {
    try {
      await prisma.providerWebhookEvent.create({ data: { provider, eventId, outcome, channelDeliveryId } })
      return true
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false
      throw err
    }
  },

  /**
   * Event row + compare-and-set of the delivery state in ONE transaction.
   * `expectedState` is what the caller saw; a concurrent change makes this a
   * no-op (the monotonic decision is re-made by that other report).
   * Returns DUPLICATE when the event row already exists.
   */
  async applyReport(input: {
    provider: string
    eventId: string
    deliveryId: string
    expectedState: ProviderDeliveryState | null
    data: { providerDeliveryState?: ProviderDeliveryState; providerStatus: string; providerStatusAt: Date; providerSegments: number | null }
    outcome: string
  }): Promise<'APPLIED' | 'NO_CHANGE' | 'DUPLICATE'> {
    try {
      return await runInTransaction(async (tx) => {
        await tx.providerWebhookEvent.create({ data: { provider: input.provider, eventId: input.eventId, outcome: input.outcome, channelDeliveryId: input.deliveryId } })
        if (input.outcome !== 'APPLIED' && input.outcome !== 'STATUS_OBSERVED') return 'NO_CHANGE'
        const result = await tx.channelDelivery.updateMany({
          where: { id: input.deliveryId, providerDeliveryState: input.expectedState },
          data: { ...input.data, ...(input.data.providerSegments == null ? { providerSegments: undefined } : {}) },
        })
        return result.count === 1 && input.outcome === 'APPLIED' ? 'APPLIED' : 'NO_CHANGE'
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'DUPLICATE'
      throw err
    }
  },
}
