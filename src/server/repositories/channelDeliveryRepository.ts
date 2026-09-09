import { Prisma, type ChannelDelivery, type ChannelDeliveryStatus } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// TypeScript literal-widening quirk (documented repeatedly elsewhere in this
// codebase, e.g. teamRepository.ts's OWNER_ROLE) — an inline enum literal
// passed straight into withTenant()'s generic would widen to plain
// `string`; naming these first keeps every enum-typed `where`/`data` below
// correctly typed.
const PENDING: ChannelDeliveryStatus = 'PENDING'
const SENDING: ChannelDeliveryStatus = 'SENDING'
const SENT: ChannelDeliveryStatus = 'SENT'
const FAILED: ChannelDeliveryStatus = 'FAILED'
const CLAIMABLE_STATUSES: ChannelDeliveryStatus[] = [PENDING, FAILED]

export type ClaimOutcome =
  | { outcome: 'CLAIMED'; delivery: ChannelDelivery }
  | { outcome: 'ALREADY_SENT'; delivery: ChannelDelivery }
  | { outcome: 'IN_PROGRESS'; delivery: ChannelDelivery }

async function findExisting(tenantId: string, businessId: string, channelConnectionId: string, messageId: string) {
  return prisma.channelDelivery.findFirst({ where: withTenant(tenantId, { businessId, channelConnectionId, messageId }) })
}

/**
 * Finds the ChannelDelivery row for this (connection, message) pair,
 * creating it as PENDING if it doesn't exist yet — same "create, catch a
 * real P2002, re-fetch the winner" pattern already established in
 * escalationService.ts (Prompt 12) and channelInboundRepository.ts (Prompt
 * 16's own race fix): two concurrent first-ever sends of the same message
 * can both miss the initial lookup, but only one `create()` can win the
 * `@@unique([channelConnectionId, messageId])` constraint, and the loser
 * simply re-fetches the winner's row rather than ever creating a second one
 * (spec §3, §9 — retry/concurrency must reuse the same row).
 */
async function ensureDeliveryRow(tenantId: string, businessId: string, channelConnectionId: string, messageId: string): Promise<ChannelDelivery> {
  const existing = await findExisting(tenantId, businessId, channelConnectionId, messageId)
  if (existing) return existing

  try {
    return await prisma.channelDelivery.create({
      data: { tenantId, businessId, channelConnectionId, messageId, status: PENDING, attemptCount: 0 },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await findExisting(tenantId, businessId, channelConnectionId, messageId)
      if (winner) return winner
    }
    throw err
  }
}

/**
 * The concurrent-send guard (Prompt 17 spec §10) — a plain conditional
 * `updateMany` compare-and-set, never an in-memory mutex and never
 * SERIALIZABLE isolation: only a delivery whose status is still
 * PENDING/FAILED at the exact moment Postgres applies the row lock for this
 * UPDATE can transition to SENDING. Two truly concurrent callers racing on
 * the same row can never both succeed — the loser's `updateMany` simply
 * matches zero rows once the winner's UPDATE has committed, because the
 * WHERE clause re-evaluates against the now-changed `status`. This is a
 * real, database-enforced guarantee that works correctly across multiple
 * serverless instances, since nothing about it lives in process memory.
 *
 * Returns:
 * - `CLAIMED` — the caller won the right to attempt `adapter.sendMessage()`
 *   now; `attemptCount` has already been incremented and `lastAttemptAt`
 *   set.
 * - `ALREADY_SENT` — a previous attempt already succeeded; the caller must
 *   never call the adapter again and should simply return this row (spec
 *   §11, idempotency).
 * - `IN_PROGRESS` — another request currently holds the SENDING claim; the
 *   caller must reject with `DELIVERY_IN_PROGRESS` rather than attempt a
 *   second concurrent send (spec §10, §12).
 */
async function claimForSending(tenantId: string, businessId: string, channelConnectionId: string, messageId: string): Promise<ClaimOutcome> {
  const delivery = await ensureDeliveryRow(tenantId, businessId, channelConnectionId, messageId)

  if (delivery.status === SENT) return { outcome: 'ALREADY_SENT', delivery }
  if (delivery.status === SENDING) return { outcome: 'IN_PROGRESS', delivery }

  const claim = await prisma.channelDelivery.updateMany({
    where: { id: delivery.id, status: { in: CLAIMABLE_STATUSES } },
    data: { status: SENDING, attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  })

  if (claim.count === 0) {
    // Lost the race — someone else's claim (or completion) landed first.
    // Re-fetch to report the current, real state rather than a stale one.
    const current = (await prisma.channelDelivery.findUnique({ where: { id: delivery.id } })) ?? delivery
    if (current.status === SENT) return { outcome: 'ALREADY_SENT', delivery: current }
    return { outcome: 'IN_PROGRESS', delivery: current }
  }

  const claimed = await prisma.channelDelivery.findUnique({ where: { id: delivery.id } })
  return { outcome: 'CLAIMED', delivery: claimed ?? delivery }
}

/** Transitions a claimed (SENDING) delivery to SENT — clears any previous error, since a later successful attempt supersedes an earlier failure. */
function markSent(deliveryId: string, externalMessageId: string | null) {
  return prisma.channelDelivery.update({
    where: { id: deliveryId },
    data: { status: SENT, deliveredAt: new Date(), externalMessageId, errorCode: null, errorMessage: null },
  })
}

/** Transitions a claimed (SENDING) delivery to FAILED — safe to retry afterward (spec §9, §11). */
function markFailed(deliveryId: string, errorCode: string, errorMessage: string) {
  return prisma.channelDelivery.update({
    where: { id: deliveryId },
    data: { status: FAILED, failedAt: new Date(), errorCode, errorMessage },
  })
}

function findByConnectionAndMessage(tenantId: string, businessId: string, channelConnectionId: string, messageId: string) {
  return findExisting(tenantId, businessId, channelConnectionId, messageId)
}

export const channelDeliveryRepository = {
  claimForSending,
  markSent,
  markFailed,
  findByConnectionAndMessage,
}
