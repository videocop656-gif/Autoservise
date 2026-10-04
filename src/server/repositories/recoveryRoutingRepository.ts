import type { ChannelConsentStatus, ChannelType, ConversationChannel, Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// ---------------------------------------------------------------------------
// MCR-6 — the data the recovery channel router reads, plus the bridge links
// it writes. Every lookup is tenant + business scoped, except the public
// bridge resolution, which can only find a link by the SHA-256 of its token.
// ---------------------------------------------------------------------------

/** Where a consent decision came from. Required: consent without provenance is not consent. */
export const CONSENT_SOURCES = ['CUSTOMER_OPT_IN_MESSAGE', 'CUSTOMER_OPT_OUT_MESSAGE', 'PROVIDER_EVENT'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

export const channelConsentRepository = {
  find(tenantId: string, businessId: string, channel: ChannelType, destinationE164: string) {
    return prisma.channelConsent.findFirst({ where: withTenant(tenantId, { businessId, channel, destinationE164 }) })
  },

  /**
   * Records an authoritative consent event (future: a WhatsApp opt-in /
   * a "STOP" reply / a provider opt-out callback). There is deliberately no
   * staff-facing "mark as opted in" path.
   */
  record(input: { tenantId: string; businessId: string; channel: ChannelType; destinationE164: string; status: ChannelConsentStatus; source: ConsentSource; at: Date }) {
    const { at, ...key } = input
    const data = { status: input.status, source: input.source, recordedAt: at, revokedAt: input.status === 'OPTED_OUT' ? at : null }
    return prisma.channelConsent.upsert({
      where: {
        tenantId_businessId_channel_destinationE164: {
          tenantId: key.tenantId,
          businessId: key.businessId,
          channel: key.channel,
          destinationE164: key.destinationE164,
        },
      },
      create: { tenantId: key.tenantId, businessId: key.businessId, channel: key.channel, destinationE164: key.destinationE164, ...data },
      update: data,
    })
  },
}

export const customerServiceWindowRepository = {
  /**
   * The latest AUTHORITATIVE inbound customer message on this channel thread:
   * received through the channel pipeline (it has a ChannelMessage mapping) —
   * never a manually logged message, never a redirect or a bridge click.
   */
  async latestInboundAt(tenantId: string, businessId: string, channel: ConversationChannel, externalConversationId: string): Promise<Date | null> {
    const found = await prisma.message.findFirst({
      where: withTenant(tenantId, {
        businessId,
        direction: 'INBOUND' as const,
        senderType: 'CUSTOMER' as const,
        channelMessage: { isNot: null },
        conversation: { channel, externalConversationId },
      }),
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    return found?.createdAt ?? null
  },
}

export const bridgeLinkRepository = {
  /** Inside the recovery transaction that creates the SMS message (so link and message commit together). */
  create(tx: Prisma.TransactionClient, data: { tenantId: string; businessId: string; callInteractionId: string; tokenHash: string; expiresAt: Date }) {
    return tx.recoveryBridgeLink.create({ data })
  },

  /** Public resolution: only by token hash (unique), never by id / call / tenant. */
  findByTokenHash(tokenHash: string) {
    return prisma.recoveryBridgeLink.findUnique({ where: { tokenHash } })
  },

  async recordOpen(id: string, at: Date): Promise<void> {
    await prisma.recoveryBridgeLink.update({ where: { id }, data: { openCount: { increment: 1 }, lastOpenedAt: at } })
    await prisma.recoveryBridgeLink.updateMany({ where: { id, firstOpenedAt: null }, data: { firstOpenedAt: at } })
  },

  async revoke(tenantId: string, businessId: string, callInteractionId: string, at: Date): Promise<void> {
    await prisma.recoveryBridgeLink.updateMany({ where: withTenant(tenantId, { businessId, callInteractionId, revokedAt: null }), data: { revokedAt: at } })
  },
}
