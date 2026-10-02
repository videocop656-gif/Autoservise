// ---------------------------------------------------------------------------
// MCR-4 — the deterministic first message after a missed call. Never
// AI-generated: no price, no diagnosis, no availability, no customer name, no
// mention of AUTOSERVISE — the customer is talking to the auto service.
//
// Each template has a stable internal key. A real provider (MCR-7, WhatsApp)
// maps the key to its own approved business-initiated template id; the text
// here is the canonical wording that template must carry.
// ---------------------------------------------------------------------------

export const MISSED_CALL_RECOVERY_V1 = 'MISSED_CALL_RECOVERY_V1'

export type RecoveryTemplateKey = typeof MISSED_CALL_RECOVERY_V1

export interface RecoveryTemplateInput {
  /** Business.name — shown so the customer knows who is writing. */
  businessName: string | null
}

export function renderRecoveryTemplate(key: RecoveryTemplateKey, input: RecoveryTemplateInput): string {
  switch (key) {
    case MISSED_CALL_RECOVERY_V1: {
      const name = input.businessName?.trim()
      const who = name ? `в автосервис «${name}»` : 'в автосервис'
      return `Здравствуйте! Вы только что звонили ${who}. Мастер сейчас занят и не смог ответить. Подскажите, пожалуйста, с каким вопросом обращаетесь?`
    }
  }
}
