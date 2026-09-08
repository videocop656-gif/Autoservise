import { describe, it, expect } from 'vitest'
import {
  applyConfidencePolicy,
  applyFabricatedActionCheck,
  applyFabricatedEscalationCheck,
  applyDefinitiveDiagnosisCheck,
  applySafetyLayer,
} from '../src/server/ai/safety'
import { EMPTY_AI_ENTITIES } from '../src/server/ai/types'
import type { ValidatedAiResult } from '../src/server/ai/aiResult.schema'

function makeResult(overrides: Partial<ValidatedAiResult> = {}): ValidatedAiResult {
  return {
    intent: 'GENERAL_QUESTION',
    confidence: 0.9,
    entities: { ...EMPTY_AI_ENTITIES },
    answer: 'Some safe answer.',
    needsHuman: false,
    reason: null,
    ...overrides,
  }
}

describe('applyConfidencePolicy', () => {
  it('forces needsHuman = true when confidence < 0.50', () => {
    const result = applyConfidencePolicy(makeResult({ confidence: 0.49, needsHuman: false }))
    expect(result.needsHuman).toBe(true)
    expect(result.reason).toBeTruthy()
  })

  it('does not touch needsHuman at exactly 0.50', () => {
    const result = applyConfidencePolicy(makeResult({ confidence: 0.5, needsHuman: false }))
    expect(result.needsHuman).toBe(false)
  })

  it('leaves a high-confidence result untouched', () => {
    const result = applyConfidencePolicy(makeResult({ confidence: 0.94, needsHuman: false }))
    expect(result.needsHuman).toBe(false)
  })

  it('never downgrades an already-true needsHuman', () => {
    const result = applyConfidencePolicy(makeResult({ confidence: 0.95, needsHuman: true, reason: 'model said so' }))
    expect(result.needsHuman).toBe(true)
    expect(result.reason).toBe('model said so')
  })

  it('preserves an existing reason when forcing needsHuman', () => {
    const result = applyConfidencePolicy(makeResult({ confidence: 0.1, needsHuman: false, reason: 'ambiguous' }))
    expect(result.reason).toBe('ambiguous')
  })
})

describe('applyFabricatedActionCheck', () => {
  it('overrides an answer that claims a booking was made', () => {
    const result = applyFabricatedActionCheck(makeResult({ answer: 'Я записал вас на завтра в 15:00.' }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('записал вас')
    expect(result.reason).toContain('AI_SAFETY_REJECTION')
  })

  it('overrides an answer that claims an appointment was confirmed (English)', () => {
    const result = applyFabricatedActionCheck(makeResult({ answer: 'Your appointment is confirmed for tomorrow at 3pm.' }))
    expect(result.needsHuman).toBe(true)
  })

  it('overrides an answer that claims a cancellation happened', () => {
    const result = applyFabricatedActionCheck(makeResult({ answer: 'Ваша запись отменена.' }))
    expect(result.needsHuman).toBe(true)
  })

  it('leaves a safe answer untouched', () => {
    const original = makeResult({ answer: 'Стоимость замены масла составляет 1500-2500 RUB.' })
    const result = applyFabricatedActionCheck(original)
    expect(result).toEqual(original)
  })
})

describe('applyFabricatedEscalationCheck (Prompt 11)', () => {
  it('overrides an answer that claims a manager was already notified', () => {
    const result = applyFabricatedEscalationCheck(makeResult({ answer: 'Я передал ваш вопрос менеджеру.' }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('передал')
    expect(result.reason).toContain('AI_SAFETY_REJECTION')
  })

  it('overrides an English escalation claim', () => {
    const result = applyFabricatedEscalationCheck(makeResult({ answer: 'I have escalated this issue to a manager.' }))
    expect(result.needsHuman).toBe(true)
  })

  it('leaves a correctly-phrased needsHuman signal untouched — no escalation action is claimed', () => {
    const original = makeResult({
      answer: 'Для точного ответа потребуется уточнение со стороны администратора сервиса.',
      needsHuman: true,
    })
    const result = applyFabricatedEscalationCheck(original)
    expect(result).toEqual(original)
  })

  it('leaves an unrelated safe answer untouched', () => {
    const original = makeResult({ answer: 'Стоимость замены масла составляет 1500-2500 RUB.' })
    const result = applyFabricatedEscalationCheck(original)
    expect(result).toEqual(original)
  })
})

describe('applyDefinitiveDiagnosisCheck (Prompt 11)', () => {
  it('overrides an answer that states a definitive diagnosis as confirmed fact', () => {
    const result = applyDefinitiveDiagnosisCheck(makeResult({ answer: 'У вас точно неисправен генератор.' }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('генератор')
    expect(result.reason).toContain('AI_SAFETY_REJECTION')
  })

  it('leaves a properly-qualified answer untouched', () => {
    const original = makeResult({
      answer: 'По описанию одной из возможных причин может быть проблема с системой зарядки. Для точного определения потребуется диагностика.',
    })
    const result = applyDefinitiveDiagnosisCheck(original)
    expect(result).toEqual(original)
  })
})

describe('applySafetyLayer', () => {
  it('applies all checks together', () => {
    const result = applySafetyLayer(makeResult({ confidence: 0.3, answer: 'Я записал вас.', needsHuman: false }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('записал вас')
  })

  it('catches a fabricated escalation claim end-to-end', () => {
    const result = applySafetyLayer(makeResult({ answer: 'Я передал ваш вопрос менеджеру.', needsHuman: false }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('передал')
  })

  it('catches a fabricated diagnosis claim end-to-end', () => {
    const result = applySafetyLayer(makeResult({ answer: 'У вас точно неисправен тормозной диск.', needsHuman: false }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('тормозной диск')
  })
})
