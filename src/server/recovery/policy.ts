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
export const NON_RETRYABLE_FAILURE_CODES: readonly string[] = ['DELIVERY_UNCERTAIN']

/**
 * Preferred recovery channels, best first. Only channel types that exist and
 * whose adapter says it can initiate a conversation are ever used. WhatsApp
 * first (the product's customer channel); SMS will join when an SMS
 * ChannelType/adapter exists. Telegram is deliberately absent: a Telegram bot
 * cannot message a phone number, so it must never become the default.
 */
export const RECOVERY_CHANNEL_PRIORITY: readonly ChannelType[] = ['WHATSAPP']

/**
 * The external thread key of a recovery conversation: the caller's E.164
 * digits without "+" (the shape WhatsApp uses for a user id). A later reply
 * from the same number lands in the same Conversation.
 */
export function recoveryThreadKey(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '')
}

export const minutes = (n: number) => n * 60_000
