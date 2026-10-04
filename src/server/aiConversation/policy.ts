import type { ConversationChannel } from '@prisma/client'

// ---------------------------------------------------------------------------
// MCR-5 — the automatic AI conversation policy, in one place (no magic
// numbers elsewhere). Business rules about WHEN the AI may answer live here
// and in aiTurnRepository's claim; the queue layer never decides any of it.
// ---------------------------------------------------------------------------

/**
 * Conversation channels whose inbound customer messages may be answered
 * automatically. WHATSAPP only: the missed-call recovery channel (mock until
 * MCR-7). TELEGRAM is deliberately NOT here — its existing live behaviour
 * (inbound → operator) must not change because it shares the Message model;
 * adding it later is a reviewed one-line change. Channels with no customer
 * delivery path (MANUAL / PHONE / OTHER / WEBSITE) are never eligible.
 */
export const AI_AUTO_REPLY_CHANNELS: readonly ConversationChannel[] = ['WHATSAPP']

export function isAutoReplyChannel(channel: ConversationChannel): boolean {
  return AI_AUTO_REPLY_CHANNELS.includes(channel)
}

/**
 * At most this many automatic AI messages in a row per conversation without
 * a human in between (counted since the last staff message or the last
 * explicit resume). The next turn hands off instead: pause + escalation.
 */
export const AI_MAX_CONSECUTIVE_AUTO_TURNS = 4

/** Attempts per turn (AI generation or delivery) before the worker gives up and hands off / leaves it FAILED. */
export const AI_TURN_MAX_ATTEMPTS = 3

/** A turn older than this is no longer answered automatically (a late bot reply is worse than none) — the message stays for staff. */
export const AI_TURN_MAX_AGE_MINUTES = 30

/** A PROCESSING turn untouched this long is treated as abandoned (crashed worker) and may be re-claimed. */
export const AI_TURN_STALE_CLAIM_SECONDS = 120

/** Failure codes never retried automatically: the message may already have reached the customer. */
export const AI_TURN_NON_RETRYABLE_CODES: readonly string[] = ['DELIVERY_UNCERTAIN']

/** Longest automatic reply sent to a customer (characters). Longer → not sent, handoff. */
export const AI_REPLY_MAX_LENGTH = 1000

/** Why automation is paused for a conversation (Conversation.aiAutomationPausedReason). */
export const AI_PAUSE_REASONS = {
  HUMAN_TAKEOVER: 'HUMAN_TAKEOVER',
  OPERATOR_PAUSED: 'OPERATOR_PAUSED',
  CUSTOMER_REQUESTED_HUMAN: 'CUSTOMER_REQUESTED_HUMAN',
  AI_NEEDS_HUMAN: 'AI_NEEDS_HUMAN',
  UNSAFE_REPLY: 'UNSAFE_REPLY',
  TURN_LIMIT: 'TURN_LIMIT',
  AI_FAILURE: 'AI_FAILURE',
} as const
export type AiPauseReason = (typeof AI_PAUSE_REASONS)[keyof typeof AI_PAUSE_REASONS]
export type AiHandoffReason = Exclude<AiPauseReason, 'HUMAN_TAKEOVER' | 'OPERATOR_PAUSED'>

/** Operator-readable escalation reason per handoff (Russian, never model text). */
export const AI_HANDOFF_REASON_TEXT: Record<AiHandoffReason, string> = {
  CUSTOMER_REQUESTED_HUMAN: 'Клиент попросил связать его с сотрудником.',
  AI_NEEDS_HUMAN: 'AI не может надёжно ответить: нужен сотрудник (диагностика, цена не настроена, спор или жалоба).',
  UNSAFE_REPLY: 'Ответ AI не прошёл проверку безопасности и не был отправлен клиенту.',
  TURN_LIMIT: 'Достигнут лимит автоматических ответов подряд — нужен сотрудник.',
  AI_FAILURE: 'AI не смог подготовить ответ после нескольких попыток.',
}

/**
 * The one customer-facing handoff text — deterministic, true (an escalation
 * really is opened before it is sent), no promised callback time.
 */
export const AI_HANDOFF_NOTICE = 'Здесь лучше подключить сотрудника автосервиса. Я передал ему наш диалог — он ответит вам здесь.'

/**
 * Obvious requests for a person, checked deterministically BEFORE any model
 * call (the model's own judgement is the second net). Deliberately phrases,
 * not single words: «мастер сказал…» must not trigger a handoff.
 */
const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  // «Позовите мастера», «Позовите лучше мастера», «Соедините с живым человеком» — at most two words in between.
  /(позовите|позови|соедините|соедини|свяжите|переключите|дайте|нужен|нужна|хочу)\s+(?:[\p{L}-]+\s+){0,2}?(с\s+)?(живого\s+|живым\s+)?(человек|оператор|администратор|мастер|менеджер|сотрудник)/iu,
  /(поговорить|связаться|общаться)\s+с\s+(живым\s+)?(человеком|оператором|администратором|мастером|менеджером|сотрудником)/iu,
  /позвоните\s+мне|перезвоните(\s+мне)?|наберите\s+мне/iu,
  /(не\s+)?(хочу|не\s+надо)\s+(с\s+)?(бот|роботом|ботом)/iu,
]

export function isExplicitHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(text))
}

export const minutes = (n: number) => n * 60_000
