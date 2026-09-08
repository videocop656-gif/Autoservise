import type { ValidatedAiResult } from './aiResult.schema'

/**
 * Confidence policy (spec §"CONFIDENCE"): the model's own `needsHuman` is
 * never trusted to be sufficient on its own. `confidence < 0.50` always
 * forces needsHuman = true server-side, overriding a false claim from the
 * provider. `0.50 <= confidence < 0.80` is documented as "requires
 * caution" but the spec doesn't call for any specific automatic action in
 * that band, so it's left to the caller (e.g. the frontend can show a
 * warning) — this function only ever flips needsHuman from false to true,
 * never the other way around.
 */
export function applyConfidencePolicy(result: ValidatedAiResult): ValidatedAiResult {
  if (result.confidence < 0.5 && !result.needsHuman) {
    return { ...result, needsHuman: true, reason: result.reason ?? 'Low confidence classification' }
  }
  return result
}

// Draft answers must never claim a real action was taken — no action is
// ever performed by analyze (spec §"AI SAFETY LAYER" #4 "No fabricated
// facts"). This is primarily enforced via the system prompt (see
// promptBuilder.ts, rules 9-10), but this is the defense-in-depth
// server-side check: if the model ignores its instructions anyway, the
// draft is neither trusted nor shown as-is.
const FABRICATED_ACTION_PATTERNS: RegExp[] = [
  /я\s+записал\s+вас/iu,
  /вы\s+записаны/iu,
  /запись\s+(подтверждена|создана|оформлена)/iu,
  /записал\s+на\s+\d/iu,
  /i(?:'ve| have)?\s+booked/iu,
  /your\s+appointment\s+(is|has\s+been)\s+(confirmed|booked|created|scheduled)/iu,
  /appointment\s+has\s+been\s+(created|confirmed|booked|cancelled|rescheduled)/iu,
  /(запись|appointment)\s+(отменена|cancelled|canceled)/iu,
]

const SAFE_FALLBACK_ANSWER =
  'Не могу подтвердить это действие самостоятельно — пожалуйста, дождитесь подтверждения от сотрудника автосервиса.'

/** Returns the result unchanged, or a safety-overridden copy if the draft answer contains an unverified action claim. */
export function applyFabricatedActionCheck(result: ValidatedAiResult): ValidatedAiResult {
  const containsFabricatedClaim = FABRICATED_ACTION_PATTERNS.some((pattern) => pattern.test(result.answer))
  if (!containsFabricatedClaim) return result

  return {
    ...result,
    answer: SAFE_FALLBACK_ANSWER,
    needsHuman: true,
    reason: 'AI_SAFETY_REJECTION: draft answer asserted an action that was never performed',
  }
}

export function applySafetyLayer(result: ValidatedAiResult): ValidatedAiResult {
  return applyConfidencePolicy(applyFabricatedActionCheck(result))
}
