/**
 * Server-side confirmation gate (spec §"CREATE APPOINTMENT — CONFIRMATION" /
 * "RESCHEDULE CONFIRMATION" / "CANCEL CONFIRMATION"). This is deliberately
 * NOT left to the model's own judgment — the same "never trust the model
 * alone" philosophy as Prompt 09's confidence policy and fabricated-action
 * check. create_appointment/reschedule_appointment/cancel_appointment all
 * call this against the CURRENT user message (never the history — a
 * confirmation has to be the customer's own latest word, not something
 * inferred from an older, possibly unrelated exchange) before executing
 * anything, regardless of what tool the model decided to call or what
 * arguments it supplied.
 *
 * Deliberately narrow: matches the explicit examples from the spec ("Да,
 * записывайте", "Да, это подходит", "Подтверждаю", "Да, на 10:00", plus
 * reasonable English equivalents) and nothing looser. A bare time mention,
 * a question ("можно?", "есть ли свободное время?"), or a stated
 * preference must NOT match — that's the whole point of requiring this
 * gate at all.
 */
// NOTE: `\b` is an ASCII-only word-boundary check in JavaScript regex — it
// does NOT recognize Cyrillic letters as "word" characters, so `/да\b/`
// silently never matches "Да, записывайте" (both sides of the boundary
// look "non-word" to the engine, so `\b` never fires there at all). The
// Cyrillic pattern below uses a negative lookahead for a following
// Cyrillic letter instead, which correctly rejects "Давайте"/"Дальше"
// while still matching "Да," / "Да." / "Да!" / a bare "Да".
const CONFIRMATION_PATTERNS: RegExp[] = [
  /^\s*да(?![а-яёА-ЯЁ])/iu, // "Да, записывайте" / "Да, это подходит" / "Да, на 10:00" / bare "Да"
  /подтвержда/iu, // "Подтверждаю" / "подтверждаю запись"
  /^\s*(yes|confirm|ok|okay)\b/iu,
  /\bgo ahead\b/iu,
  /\bbook it\b/iu,
  /\bthat works\b/iu,
  /\bsounds good\b/iu,
]

export function isExplicitConfirmation(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  return CONFIRMATION_PATTERNS.some((pattern) => pattern.test(trimmed))
}
