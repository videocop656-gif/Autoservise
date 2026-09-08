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

// Prompt 11 §"HUMAN HANDOFF LANGUAGE": needsHuman=true is only a signal on
// the result — no escalation mechanism exists yet (that's Prompt 12), so a
// draft claiming staff/a manager was actually notified is the same category
// of fabricated-action claim as "your appointment is booked" above.
const FABRICATED_ESCALATION_PATTERNS: RegExp[] = [
  /я\s+(уже\s+)?передал[а]?\s+(ваш\s+)?(вопрос|запрос|обращение)/iu,
  /(вопрос|запрос|обращение)\s+(уже\s+)?передан[оа]?\s+(менеджер|сотрудник|специалист)/iu,
  /я\s+(уже\s+)?связал(ся|ась)\s+с\s+(менеджер|сотрудник)/iu,
  /i(?:'ve| have)?\s+(escalated|forwarded|passed)\s+(this|your)\s+(question|request|issue)\s+to\s+a\s+(manager|human|specialist|team)/iu,
  /(a\s+)?manager\s+(has\s+been\s+)?(notified|contacted)/iu,
]

const SAFE_ESCALATION_FALLBACK_ANSWER = 'Для точного ответа потребуется уточнение со стороны администратора сервиса.'

/** Returns the result unchanged, or a safety-overridden copy if the draft answer falsely claims a human was already notified. */
export function applyFabricatedEscalationCheck(result: ValidatedAiResult): ValidatedAiResult {
  const containsClaim = FABRICATED_ESCALATION_PATTERNS.some((pattern) => pattern.test(result.answer))
  if (!containsClaim) return result

  return {
    ...result,
    answer: SAFE_ESCALATION_FALLBACK_ANSWER,
    needsHuman: true,
    reason: 'AI_SAFETY_REJECTION: draft answer claimed a human/manager was already notified, but no escalation mechanism exists yet',
  }
}

// Prompt 11 §"DO NOT TURN HISTORY INTO DIAGNOSIS" / AI_BEHAVIOR_CONTRACT.md
// §8: Service History and a customer's description of a symptom are
// evidence, never a confirmed diagnosis. This is a narrow, deterministic
// net for the clearest violations (the spec's own worked example: "У вас
// точно неисправен генератор") — not a general diagnosis classifier; it
// deliberately does not try to catch every possible diagnostic phrasing,
// the same way FABRICATED_ACTION_PATTERNS doesn't catch every possible
// booking claim.
const DEFINITIVE_DIAGNOSIS_PATTERNS: RegExp[] = [
  /у\s+вас\s+(точно|однозначно|определённо)\s+(неисправ|сломан|вышел\s+из\s+строя)/iu,
  /(это|у\s+вас)\s+(точно|однозначно)\s+(проблема|неисправность)\s+(в|с)\s+/iu,
  /you\s+definitely\s+have\s+a\s+(faulty|broken|failed)/iu,
]

const SAFE_DIAGNOSIS_FALLBACK_ANSWER =
  'По имеющейся информации нельзя точно определить причину — рекомендуется очная диагностика в сервисе.'

/** Returns the result unchanged, or a safety-overridden copy if the draft answer states a definitive diagnosis as confirmed fact. */
export function applyDefinitiveDiagnosisCheck(result: ValidatedAiResult): ValidatedAiResult {
  const containsDiagnosis = DEFINITIVE_DIAGNOSIS_PATTERNS.some((pattern) => pattern.test(result.answer))
  if (!containsDiagnosis) return result

  return {
    ...result,
    answer: SAFE_DIAGNOSIS_FALLBACK_ANSWER,
    needsHuman: true,
    reason: 'AI_SAFETY_REJECTION: draft answer asserted a definitive vehicle diagnosis that available data does not establish',
  }
}

export function applySafetyLayer(result: ValidatedAiResult): ValidatedAiResult {
  return applyConfidencePolicy(applyDefinitiveDiagnosisCheck(applyFabricatedEscalationCheck(applyFabricatedActionCheck(result))))
}
