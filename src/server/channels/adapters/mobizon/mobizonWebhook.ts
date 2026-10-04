import { createHash } from 'node:crypto'
import { z } from 'zod'
import { timingSafeEqualStrings } from '../../../lib/timingSafeCompare'

// ---------------------------------------------------------------------------
// MCR-7A — Mobizon webhook protocol (official docs, "Вебхуки"):
//
//   POST, JSON (webhook "Формат данных: json"), event "sms-delivery-report":
//   { eventId, eventType, eventCreateTs, webhookId, attempt,
//     data: { campaignId, messageId, segNum, statusUpdateTs, status, to },
//     sign }
//   sign = SHA1(eventId + "|" + attempt + "|" + eventCreateTs + "|" + secretKey)
//   retries: up to 10 attempts, SAME eventId, until a 2xx within 5 s.
//
// NOTE (documented limitation of Mobizon's scheme): the signature covers
// eventId / attempt / eventCreateTs only — NOT `data`. A valid signature
// proves the event came from Mobizon, not that `data` is untampered. The
// report service therefore never trusts data.status: it re-reads the status
// from the API (Message.GetSMSStatus) and cross-checks data.to.
// ---------------------------------------------------------------------------

const id = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(String)

export const mobizonWebhookSchema = z.object({
  eventId: id,
  eventType: z.string().max(100),
  eventCreateTs: z.string().max(40),
  attempt: id,
  sign: z.string().max(100),
  data: z
    .object({
      messageId: id.optional(),
      status: z.string().max(40).optional(),
      segNum: z.union([z.number(), z.string()]).optional(),
      to: z.union([z.string(), z.number()]).transform(String).optional(),
    })
    .passthrough()
    .optional(),
})
export type MobizonWebhookEvent = z.infer<typeof mobizonWebhookSchema>

export function mobizonSignature(event: Pick<MobizonWebhookEvent, 'eventId' | 'attempt' | 'eventCreateTs'>, secret: string): string {
  return createHash('sha1').update(`${event.eventId}|${event.attempt}|${event.eventCreateTs}|${secret}`, 'utf8').digest('hex')
}

/** Constant-time check of `sign`. False for any missing / malformed signature. */
export function verifyMobizonSignature(event: MobizonWebhookEvent, secret: string): boolean {
  if (!/^[0-9a-fA-F]{40}$/.test(event.sign)) return false
  return timingSafeEqualStrings(event.sign.toLowerCase(), mobizonSignature(event, secret))
}
