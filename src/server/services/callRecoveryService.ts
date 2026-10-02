import { Prisma } from '@prisma/client'
import { ApiError } from '../lib/errors'
import { logger } from '../lib/logger'
import { maskPhone } from '../lib/phone'
import { businessRepository } from '../repositories/businessRepository'
import { callRecoveryRepository } from '../repositories/callRecoveryRepository'
import { channelTypeToConversationChannel } from '../channels/types'
import { selectRecoveryChannel } from '../recovery/channelRouter'
import { recoveryThreadKey } from '../recovery/policy'
import { MISSED_CALL_RECOVERY_V1, renderRecoveryTemplate } from '../recovery/templates'
import { deliverSystemMessage } from './channelDeliveryService'

// ---------------------------------------------------------------------------
// MCR-4 — Missed Call Recovery Engine.
//
//   READY call → atomic claim (anti-spam, late-answer re-check)
//   → Recovery Channel Router (best eligible configured channel; none → FAILED)
//   → find-or-create the channel Conversation for the caller's number
//   → ONE deterministic SYSTEM message (template MISSED_CALL_RECOVERY_V1),
//     created and linked to the call in the same transaction that re-checks
//     the call is still CLAIMED and still MISSED
//   → the existing ChannelDelivery pipeline (deliverSystemMessage)
//   → SENT (delivery SENT = provider accepted) / FAILED (retryable) /
//     FAILED DELIVERY_UNCERTAIN (a send may have happened — never auto-resent).
//
// Never: an AI call, a Customer / Vehicle / CustomerRequest / Appointment
// write, a staff user. The scope is the call's own tenant + business.
// ---------------------------------------------------------------------------

export type RecoveryOutcome = 'SENT' | 'FAILED' | 'SUPPRESSED' | 'NOT_ELIGIBLE' | 'SKIPPED'

const SYSTEM_SUBJECT = 'Пропущенный звонок'

async function findOrCreateRecoveryConversation(
  scope: { tenantId: string; businessId: string },
  connection: { id: string; type: 'TELEGRAM' | 'WHATSAPP' | 'WEBSITE' },
  threadKey: string,
  customerId: string | null,
  tx: Prisma.TransactionClient
) {
  const where = { tenantId: scope.tenantId, businessId: scope.businessId, channelConnectionId: connection.id, externalConversationId: threadKey }
  const existing = await tx.conversation.findFirst({ where })
  if (existing) return existing
  // ON CONFLICT DO NOTHING on (channelConnectionId, externalConversationId):
  // a concurrent inbound message for the same number can't create a second thread.
  await tx.conversation.createMany({
    data: [
      {
        ...where,
        channel: channelTypeToConversationChannel(connection.type),
        customerId,
        subject: SYSTEM_SUBJECT,
        startedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  })
  return tx.conversation.findFirstOrThrow({ where })
}

/** Runs the recovery of ONE call. Safe to call any number of times, concurrently. */
export async function processRecovery(callId: string, now: Date = new Date()): Promise<RecoveryOutcome> {
  const claim = await callRecoveryRepository.claim(callId, now)
  if (claim.kind !== 'CLAIMED') return claim.kind

  const call = claim.call
  const scope = { tenantId: call.tenantId, businessId: call.businessId }
  const destination = call.remotePhoneE164! // guaranteed by the claim (READY requires it)

  // Retry of an attempt that already created its message: deliver that same
  // message again (idempotent per ChannelDelivery), never a second one.
  let messageId = call.recoveryMessageId
  if (!messageId) {
    const route = await selectRecoveryChannel(scope, destination)
    if (!route.ok) {
      await callRecoveryRepository.transitionFromClaimed(call.id, { recoveryState: 'FAILED', recoveryFailureCode: 'NO_ELIGIBLE_CHANNEL' })
      logger.info('call_recovery_no_channel', { blocked: route.blocked.map((b) => `${b.channelType}:${b.reason}`).join(','), caller: maskPhone(destination) })
      return 'FAILED'
    }
    const business = await businessRepository.findFirstByTenant(scope.tenantId)
    const content = renderRecoveryTemplate(MISSED_CALL_RECOVERY_V1, { businessName: business?.id === scope.businessId ? business.name : null })

    const created = await callRecoveryRepository.withClaimedMissedCall(call.id, async (tx, locked) => {
      const conversation = await findOrCreateRecoveryConversation(scope, route.connection, recoveryThreadKey(destination), locked.customerId, tx)
      const message = await tx.message.create({
        data: { ...scope, conversationId: conversation.id, direction: 'OUTBOUND', senderType: 'SYSTEM', content },
      })
      await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } })
      await callRecoveryRepository.transitionFromClaimed(
        call.id,
        { recoveryConversationId: conversation.id, recoveryMessageId: message.id, recoveryTemplateKey: MISSED_CALL_RECOVERY_V1 },
        tx
      )
      messageId = message.id
    })
    if (created === 'ANSWERED') return 'NOT_ELIGIBLE'
    if (created === 'LOST_CLAIM') return 'SKIPPED'
  } else {
    // Retries re-check the late-answer rule too, before sending again.
    const still = await callRecoveryRepository.withClaimedMissedCall(call.id, async () => {})
    if (still === 'ANSWERED') return 'NOT_ELIGIBLE'
    if (still === 'LOST_CLAIM') return 'SKIPPED'
  }

  try {
    const attempt = await deliverSystemMessage(scope, messageId!)
    if (attempt.status === 'SENT') {
      await callRecoveryRepository.transitionFromClaimed(call.id, { recoveryState: 'SENT', recoverySentAt: attempt.delivery.deliveredAt ?? now })
      return 'SENT'
    }
    // IN_PROGRESS = a previous attempt is (or crashed while) talking to the
    // provider: the message may already be out — never send it again blindly.
    const code = attempt.status === 'IN_PROGRESS' ? 'DELIVERY_UNCERTAIN' : attempt.errorCode
    await callRecoveryRepository.transitionFromClaimed(call.id, { recoveryState: 'FAILED', recoveryFailureCode: code })
    return 'FAILED'
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'RECOVERY_ERROR'
    await callRecoveryRepository.transitionFromClaimed(call.id, { recoveryState: 'FAILED', recoveryFailureCode: code })
    logger.warn('call_recovery_send_failed', { code })
    return 'FAILED'
  }
}

export interface RecoveryBatchSummary {
  processed: number
  sent: number
  failed: number
  suppressed: number
  notEligible: number
  skipped: number
}

/** One processor pass over all tenants' claimable calls (oldest miss first), each processed independently. */
export async function processPendingRecoveries(options: { limit?: number; now?: Date } = {}): Promise<RecoveryBatchSummary> {
  const now = options.now ?? new Date()
  const candidates = await callRecoveryRepository.listClaimable(now, Math.min(Math.max(options.limit ?? 20, 1), 50))
  const summary: RecoveryBatchSummary = { processed: 0, sent: 0, failed: 0, suppressed: 0, notEligible: 0, skipped: 0 }
  for (const { id } of candidates) {
    const outcome = await processRecovery(id, now)
    summary.processed++
    if (outcome === 'SENT') summary.sent++
    else if (outcome === 'FAILED') summary.failed++
    else if (outcome === 'SUPPRESSED') summary.suppressed++
    else if (outcome === 'NOT_ELIGIBLE') summary.notEligible++
    else summary.skipped++
  }
  return summary
}

