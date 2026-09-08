import { describe, it, expect } from 'vitest'
import { applyConfidencePolicy, applyFabricatedActionCheck, applySafetyLayer } from '../src/server/ai/safety'
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

describe('applySafetyLayer', () => {
  it('applies both checks together', () => {
    const result = applySafetyLayer(makeResult({ confidence: 0.3, answer: 'Я записал вас.', needsHuman: false }))
    expect(result.needsHuman).toBe(true)
    expect(result.answer).not.toContain('записал вас')
  })
})
