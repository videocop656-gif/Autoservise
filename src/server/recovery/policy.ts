import type { ChannelType } from '@prisma/client'

// ---------------------------------------------------------------------------
// MCR-4 — the recovery policy, in one place (no magic numbers elsewhere).
// ---------------------------------------------------------------------------

/**
 * Anti-spam: at most one initial recovery message per caller per business in
 * this window. A later missed call whose detection time is within this many
 * minutes of an earlier recovery that was CLAIMED or SENT for the same
 * canonical phone is SUPPRESSED (kept, never merged). FAILED recoveries do not
 * suppress — a failed attempt never blocks the next genuine call.
 */
export const RECOVERY_ANTI_SPAM_WINDOW_MINUTES = 15

/**
 * "Вы только что звонили" stops being true after a while: a call whose miss
 * was detected longer ago than this is no longer recovered (SUPPRESSED,
 * TOO_LATE) — also the age limit for retrying a FAILED attempt.
 */
export const RECOVERY_MAX_AGE_MINUTES = 30

/** A FAILED recovery is retried until this many attempts (while fresh). */
export const RECOVERY_MAX_ATTEMPTS = 3

/** A CLAIMED recovery untouched for this long is treated as abandoned (crashed processor) and may be re-claimed. */
export const RECOVERY_STALE_CLAIM_SECONDS = 120

/** Failure codes that must never be retried automatically (a person decides). */
// MCR-7A — SMS_REJECTED / INVALID_DESTINATION: the provider refused this number
// or content; resending the same SMS cannot succeed.
export const NON_RETRYABLE_FAILURE_CODES: readonly string[] = ['DELIVERY_UNCERTAIN', 'SMS_REJECTED', 'INVALID_DESTINATION']

/**
 * MCR-6 — the recovery routes, best first: a business-initiated WhatsApp
 * message when it is genuinely permitted, otherwise an SMS that bridges the
 * customer into the business's WhatsApp chat. Telegram is deliberately
 * absent: a Telegram bot cannot message a phone number, and the customer
 * must never need Telegram (or any app/account) to be recovered.
 * The decision itself lives in recovery/channelRouter.ts.
 */
export const RECOVERY_ROUTE_CHANNELS: readonly ChannelType[] = ['WHATSAPP', 'SMS']

/**
 * WhatsApp customer-service window: after the customer's own last inbound
 * WhatsApp message, free-form business messages are allowed for this long.
 * The ONE place this number lives (derived from authoritative inbound
 * Messages — see recoveryRoutingRepository).
 */
export const WHATSAPP_CUSTOMER_SERVICE_WINDOW_HOURS = 24

/** An SMS bridge link stops working after this long (the "you just called" moment is long gone). */
export const RECOVERY_BRIDGE_LINK_TTL_HOURS = 72

/** A recovery SMS must fit in this many segments (UCS-2 for Russian: 2 × 67 units). */
export const RECOVERY_SMS_MAX_SEGMENTS = 2

/** Business name is cut to this many characters in the SMS so the message stays within RECOVERY_SMS_MAX_SEGMENTS. */
export const RECOVERY_SMS_MAX_NAME_LENGTH = 24

/**
 * The text pre-filled in WhatsApp when the customer opens the bridge. The
 * customer still has to press send — and only that sent message is an
 * inbound message. No phone, call id, token or tenant in it.
 */
export const RECOVERY_BRIDGE_PREFILL_TEXT = 'Здравствуйте! Я только что звонил(а) в автосервис.'

/**
 * The external thread key of a recovery conversation: the caller's E.164
 * digits without "+" (the shape WhatsApp uses for a user id). A later reply
 * from the same number lands in the same Conversation.
 */
export function recoveryThreadKey(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '')
}

export const minutes = (n: number) => n * 60_000
