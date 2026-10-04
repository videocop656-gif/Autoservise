// ---------------------------------------------------------------------------
// MCR-4 — the deterministic first message after a missed call. Never
// AI-generated: no price, no diagnosis, no availability, no customer name, no
// mention of AUTOSERVISE — the customer is talking to the auto service.
//
// Each template has a stable internal key. A real provider (MCR-7, WhatsApp)
// maps the key to its own approved business-initiated template id; the text
// here is the canonical wording that template must carry.
// ---------------------------------------------------------------------------

import { RECOVERY_SMS_MAX_NAME_LENGTH } from './policy'
import { estimateSmsSegments } from '../lib/smsSegments'

export const MISSED_CALL_RECOVERY_V1 = 'MISSED_CALL_RECOVERY_V1'

/**
 * MCR-6 — the SMS bridge recovery: short (Russian SMS are UCS-2: 2 parts =
 * 134 characters), one clear CTA, the business's own bridge link. No
 * customer name, price, diagnosis or availability.
 */
export const MISSED_CALL_SMS_BRIDGE_V1 = 'MISSED_CALL_SMS_BRIDGE_V1'

export type RecoveryTemplateKey = typeof MISSED_CALL_RECOVERY_V1 | typeof MISSED_CALL_SMS_BRIDGE_V1

export interface RecoveryTemplateInput {
  /** Business.name — shown so the customer knows who is writing. */
  businessName: string | null
  /** MISSED_CALL_SMS_BRIDGE_V1 only: the public /r/<token> link. */
  bridgeUrl?: string
}

/**
 * MCR-7A — SMS wording variants, richest first. Russian SMS are UCS-2
 * (70 characters in one SMS, 67 per part in a long one), so the link alone
 * can decide the price: the template picks the FIRST (richest) variant that
 * reaches the FEWEST segments for the actual link. Deterministic; a long
 * link never makes the text vaguer for nothing, a short link buys one SMS.
 */
const SMS_BRIDGE_VARIANTS: ((who: string | null) => string)[] = [
  (who) => `Вы звонили ${who ?? 'в автосервис'}, мастер был занят. Продолжим в WhatsApp: `,
  (who) => `Вы звонили ${who ?? 'нам'}. Напишите нам в WhatsApp: `,
  // Shortest. The workshop name is never dropped when it exists: with a shared
  // sender it is the customer's only clue who is writing.
  (who) => `Вы звонили ${who ?? 'нам'}. WhatsApp: `,
]

export function smsBridgeCandidates(businessName: string | null, bridgeUrl: string): string[] {
  const name = businessName?.trim()
  const who = name ? `в «${shortName(name)}»` : null
  return SMS_BRIDGE_VARIANTS.map((variant) => `${variant(who)}${bridgeUrl}`)
}

export function pickSmsBridgeText(businessName: string | null, bridgeUrl: string): string {
  const candidates = smsBridgeCandidates(businessName, bridgeUrl)
  const segments = candidates.map((text) => estimateSmsSegments(text).segments)
  const fewest = Math.min(...segments)
  return candidates[segments.indexOf(fewest)]!
}

function shortName(name: string): string {
  return name.length > RECOVERY_SMS_MAX_NAME_LENGTH ? `${name.slice(0, RECOVERY_SMS_MAX_NAME_LENGTH - 1).trimEnd()}…` : name
}

export function renderRecoveryTemplate(key: RecoveryTemplateKey, input: RecoveryTemplateInput): string {
  switch (key) {
    case MISSED_CALL_RECOVERY_V1: {
      const name = input.businessName?.trim()
      const who = name ? `в автосервис «${name}»` : 'в автосервис'
      return `Здравствуйте! Вы только что звонили ${who}. Мастер сейчас занят и не смог ответить. Подскажите, пожалуйста, с каким вопросом обращаетесь?`
    }
    case MISSED_CALL_SMS_BRIDGE_V1: {
      if (!input.bridgeUrl) throw new Error('MISSED_CALL_SMS_BRIDGE_V1 needs a bridge URL')
      return pickSmsBridgeText(input.businessName, input.bridgeUrl)
    }
  }
}
