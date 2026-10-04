import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { maskPhone, normalizePhone } from '../lib/phone'
import { prisma } from '../db/prisma'
import type { AuthContext } from '../types/auth'
import { formParams, verifyTwilioSignature } from '../channels/adapters/twilio/twilioSignature'
import { inboundKind, TWILIO_PROVIDER } from '../channels/adapters/twilio/twilioWhatsAppAdapter'
import { mapTwilioStatus, canAdvanceDeliveryState, isFinalDeliveryState } from '../channels/deliveryStatus'
import { resolveProviderWebhookContext } from '../channels/providerWebhookContext'
import { channelConnectionRepository, channelRoutingKey } from '../repositories/channelConnectionRepository'
import { attributeWhatsAppInbound } from '../repositories/recoveryRoutingRepository'
import { smsDeliveryReportRepository as deliveryReportRepository } from '../repositories/smsDeliveryReportRepository'
import { conversationRepository } from '../repositories/conversationRepository'
import { receiveIncoming } from './channelMessageService'
import { openOrReuseEscalation } from './escalationService'

// ---------------------------------------------------------------------------
// MCR-7B1 — Twilio WhatsApp webhooks (inbound messages + status callbacks).
//
// Inbound, in order — nothing is written before step 4 passes:
//   1. bounded form params                       → 400
//   2. TWILIO_AUTH_TOKEN + canonical URL known   → else 503 (never accept unsigned)
//   3. X-Twilio-Signature over OUR canonical URL → 403
//   4. AccountSid must be our account            → 403
//   5. To (whatsapp:+E164) → routingKey → the ONE active connection
//      (unknown sender → 200, nothing written, nothing revealed)
//   6. From → canonical customer E.164
//   7. a MessageSid already recorded on ANOTHER connection → 200, ignored
//   8. the existing inbound pipeline (receiveIncoming): MessageSid
//      idempotency, conversation, MCR-1 / Prompt 54 customer link, MCR-5 turn
//      + ai-conversation-reply job — the AI runs later, in the queue consumer
//   9. first time only: SMS-bridge attribution; media / location without
//      text → operator handoff (escalation + AI pause), never sent to the AI
// Payload tenantId / businessId / conversationId are never read.
// ---------------------------------------------------------------------------

export interface TwilioWebhookResult {
  httpStatus: 200 | 400 | 403 | 503
  outcome: string
}

function authenticate(params: Record<string, string> | null, url: string | null, signature: unknown): TwilioWebhookResult | null {
  if (!params) return { httpStatus: 400, outcome: 'MALFORMED' }
  const authToken = env.twilioAuthToken
  if (!authToken || !url) {
    logger.warn('twilio_webhook_rejected', { reason: 'NOT_CONFIGURED' })
    return { httpStatus: 503, outcome: 'NOT_CONFIGURED' }
  }
  if (!verifyTwilioSignature(url, params, signature, authToken)) {
    logger.warn('twilio_webhook_rejected', { reason: 'BAD_SIGNATURE' })
    return { httpStatus: 403, outcome: 'BAD_SIGNATURE' }
  }
  if (!env.twilioAccountSid || params.AccountSid !== env.twilioAccountSid) {
    logger.warn('twilio_webhook_rejected', { reason: 'FOREIGN_ACCOUNT' })
    return { httpStatus: 403, outcome: 'FOREIGN_ACCOUNT' }
  }
  return null
}

const whatsappE164 = (address: string | undefined) => (address ? normalizePhone(address.replace(/^whatsapp:/i, ''), null) : null)

export async function handleTwilioInbound(input: { body: unknown; url: string | null; signature: unknown; now?: Date }): Promise<TwilioWebhookResult> {
  const now = input.now ?? new Date()
  const params = formParams(input.body)
  const rejected = authenticate(params, input.url, input.signature)
  if (rejected) return rejected
  const p = params!

  // --- authentic from here on ---
  const senderE164 = whatsappE164(p.To)
  const routingKey = senderE164 ? channelRoutingKey({ type: 'WHATSAPP', provider: TWILIO_PROVIDER, senderE164 }) : null
  const connection = routingKey ? await channelConnectionRepository.findActiveByRoutingKey(routingKey) : null
  if (!connection) {
    logger.warn('twilio_inbound_unknown_sender', { to: maskPhone(senderE164) })
    return { httpStatus: 200, outcome: 'UNKNOWN_SENDER' }
  }
  const customerE164 = whatsappE164(p.From)
  if (!customerE164 || !p.MessageSid) return { httpStatus: 200, outcome: 'IGNORED_INVALID_FROM' }

  // A MessageSid is global at Twilio: one already recorded on ANOTHER connection is never re-routed.
  const elsewhere = await prisma.channelMessage.findFirst({ where: { externalMessageId: p.MessageSid, NOT: { channelConnectionId: connection.id } }, select: { id: true } })
  if (elsewhere) {
    logger.warn('twilio_inbound_sid_conflict', { connectionId: connection.id })
    return { httpStatus: 200, outcome: 'SID_CONFLICT' }
  }

  const ctx = await resolveProviderWebhookContext(connection, 'twilio-webhook')
  if (!ctx) return { httpStatus: 200, outcome: 'UNKNOWN_SENDER' }
  const kind = inboundKind(p)
  const result = await receiveIncoming(ctx, connection.id, p, { suppressAiTurn: kind !== 'TEXT' })
  if (!result.duplicate) {
    const attribution = await attributeWhatsAppInbound(ctx.tenant.id, ctx.business.id, customerE164, now)
    if (kind !== 'TEXT') await handOffUnsupported(ctx, result.conversationId, kind, now)
    logger.info('twilio_inbound_recorded', { connectionId: connection.id, kind, attribution, aiReplyJob: result.aiReplyJob ?? null, from: maskPhone(customerE164) })
  }
  return { httpStatus: 200, outcome: result.duplicate ? 'DUPLICATE' : 'RECORDED' }
}

const UNSUPPORTED_REASON = {
  MEDIA: 'Клиент прислал вложение без текста — AI вложения не обрабатывает.',
  LOCATION: 'Клиент прислал геолокацию — нужен сотрудник.',
} as const

/** Media / location without text: never sent to the AI — a person takes it (escalation + AI paused). */
async function handOffUnsupported(ctx: AuthContext, conversationId: string, kind: 'MEDIA' | 'LOCATION', now: Date) {
  const conversation = await conversationRepository.findById(ctx.tenant.id, ctx.business.id, conversationId)
  await openOrReuseEscalation(ctx, {
    conversationId,
    customerId: conversation?.customerId ?? null,
    reason: UNSUPPORTED_REASON[kind],
    summary: 'Сообщение WhatsApp без текста. Откройте диалог и ответьте клиенту.',
  })
  if (conversation && !conversation.aiAutomationPausedAt) {
    await conversationRepository.setAiAutomation(ctx.tenant.id, ctx.business.id, conversationId, { aiAutomationPausedAt: now, aiAutomationPausedReason: 'UNSUPPORTED_MESSAGE' })
  }
}

/**
 * Status callbacks (MessageSid, MessageStatus, EventType=READ). Fully signed,
 * so the reported status is trusted once the signature passes. Matched ONLY
 * by our stored (twilio, MessageSid). Idempotent per (sid, status, eventType);
 * monotonic (callbacks may arrive out of order — official docs).
 */
export async function handleTwilioStatus(input: { body: unknown; url: string | null; signature: unknown; now?: Date }): Promise<TwilioWebhookResult> {
  const now = input.now ?? new Date()
  const params = formParams(input.body)
  const rejected = authenticate(params, input.url, input.signature)
  if (rejected) return rejected
  const p = params!
  if (!p.MessageSid || !p.MessageStatus) return { httpStatus: 400, outcome: 'MALFORMED' }

  const eventId = `${p.MessageSid}:${p.MessageStatus.toLowerCase()}:${(p.EventType ?? '').toUpperCase()}`.slice(0, 120)
  if (await deliveryReportRepository.findEvent(TWILIO_PROVIDER, eventId)) return { httpStatus: 200, outcome: 'DUPLICATE' }
  const found = await deliveryReportRepository.findDelivery(TWILIO_PROVIDER, p.MessageSid)
  if (!found) {
    await deliveryReportRepository.recordEvent(TWILIO_PROVIDER, eventId, 'UNKNOWN_MESSAGE')
    return { httpStatus: 200, outcome: 'UNKNOWN_MESSAGE' }
  }
  const { delivery } = found
  const next = mapTwilioStatus(p.MessageStatus, p.EventType)
  const current = delivery.providerDeliveryState
  const outcome = !next ? (isFinalDeliveryState(current) ? 'NO_CHANGE' : 'STATUS_OBSERVED') : canAdvanceDeliveryState(current, next) ? 'APPLIED' : 'NO_CHANGE'
  const rawStatus = `${p.MessageStatus}${p.ErrorCode ? `:${p.ErrorCode}` : ''}`.slice(0, 40)
  const result = await deliveryReportRepository.applyReport({
    provider: TWILIO_PROVIDER,
    eventId,
    deliveryId: delivery.id,
    expectedState: current,
    outcome,
    data: { ...(outcome === 'APPLIED' && next ? { providerDeliveryState: next } : {}), providerStatus: rawStatus, providerStatusAt: now, providerSegments: null },
  })
  logger.info('whatsapp_delivery_report', { provider: TWILIO_PROVIDER, deliveryId: delivery.id, status: rawStatus, state: next, result })
  return { httpStatus: 200, outcome: result === 'DUPLICATE' ? 'DUPLICATE' : outcome }
}
