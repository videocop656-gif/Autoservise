import { Prisma, type ConversationChannel } from '@prisma/client'
import { prisma } from '../db/prisma'

export interface RecordInboundInput {
  tenantId: string
  businessId: string
  channelConnectionId: string
  channelType: ConversationChannel
  externalConversationId: string
  externalMessageId: string
  text: string
  sentAt: Date
  /** Only ever applied when a NEW Conversation is created — an existing conversation's customerId is never overwritten by this pipeline (spec doesn't ask for re-linking an ongoing conversation; a deliberate simplification, see channelMessageService.ts). */
  customerId: string | null
}

export interface RecordInboundResult {
  conversation: { id: string; customerId: string | null; status: string }
  message: { id: string; createdAt: Date }
  wasConversationCreated: boolean
  wasConversationReopened: boolean
}

/**
 * The one atomic multi-model transaction the whole inbound pipeline needs
 * (spec §"INBOUND MESSAGE SERVICE": "Все необходимые DB operations
 * выполнить транзакционно") — find-or-create/reopen Conversation, create
 * Message(INBOUND, CUSTOMER), create the ChannelMessage idempotency
 * mapping, and touch Conversation.lastMessageAt, all in one
 * `$transaction`. Lives in the repository layer (not the service), same
 * convention as customerRequestRepository.createWithInitialHistory() and
 * teamRepository.deactivate() — the caller (channelMessageService.ts) has
 * already made every business decision (is the connection active, does an
 * idempotent duplicate already exist, who the customer resolves to) before
 * this is ever called; this function only executes the writes.
 *
 * The ChannelMessage unique constraint (`channelConnectionId` +
 * `externalMessageId`) is the LAST line of defense against a genuine
 * concurrent duplicate (spec §"IDEMPOTENCY RACE TEST") — if two requests
 * for the same external message race past the service's own pre-check,
 * Postgres accepts exactly one `create()` here and the loser's
 * transaction throws a real `P2002`; channelMessageService.ts catches
 * that and re-fetches the winner's row rather than ever creating a second
 * Message.
 *
 * The Conversation resolution below has the identical race for a NEW
 * external thread: two concurrent "first messages" can both miss the
 * initial `findFirst`, both attempt `create()`, and the loser hits
 * Conversation's own `@@unique([channelConnectionId,
 * externalConversationId])` constraint — this is caught the same way
 * (P2002 → re-fetch the winner) rather than ever creating two
 * Conversations for one external thread. This bug was found live against
 * a real Supabase database by a genuinely concurrent smoke-test run
 * before being fixed here — see the smoke test's own dedicated race
 * check.
 */
export async function recordInboundMessage(input: RecordInboundInput): Promise<RecordInboundResult> {
  return prisma.$transaction(async (tx) => {
    const conversationLookup = {
      tenantId: input.tenantId,
      businessId: input.businessId,
      channelConnectionId: input.channelConnectionId,
      externalConversationId: input.externalConversationId,
    }

    let conversation = await tx.conversation.findFirst({ where: conversationLookup })

    let wasConversationCreated = false
    let wasConversationReopened = false

    if (!conversation) {
      try {
        conversation = await tx.conversation.create({
          data: {
            ...conversationLookup,
            channel: input.channelType,
            status: 'OPEN',
            startedAt: input.sentAt,
            customerId: input.customerId,
          },
        })
        wasConversationCreated = true
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Lost a genuine concurrent-creation race for this exact
          // external thread — the winner's row is now findable; this is a
          // real, correctly-handled reuse, never a fabricated duplicate.
          conversation = await tx.conversation.findFirst({ where: conversationLookup })
        }
        if (!conversation) throw err
      }
    }

    if (conversation.status === 'CLOSED') {
      // Spec §"CLOSED CONVERSATION": a valid inbound message on an active
      // connection reopens a closed conversation — transactionally, as
      // part of the very same write that records the message.
      conversation = await tx.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN', closedAt: null },
      })
      wasConversationReopened = true
    }

    const message = await tx.message.create({
      data: {
        tenantId: input.tenantId,
        businessId: input.businessId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        senderType: 'CUSTOMER',
        content: input.text,
        createdAt: input.sentAt,
      },
    })

    await tx.channelMessage.create({
      data: {
        tenantId: input.tenantId,
        businessId: input.businessId,
        channelConnectionId: input.channelConnectionId,
        messageId: message.id,
        externalMessageId: input.externalMessageId,
        externalConversationId: input.externalConversationId,
      },
    })

    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt },
    })

    return {
      conversation: { id: conversation.id, customerId: conversation.customerId, status: conversation.status },
      message: { id: message.id, createdAt: message.createdAt },
      wasConversationCreated,
      wasConversationReopened,
    }
  })
}
