import { describe, it, expect } from 'vitest'
import { aiResultSchema, aiEntitiesSchema } from '../src/server/ai/aiResult.schema'

function validEntities() {
  return {
    customerName: null,
    phone: null,
    vehicleMake: null,
    vehicleModel: null,
    licensePlate: null,
    serviceName: 'Замена масла',
    requestedDate: null,
    requestedTime: null,
  }
}

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'PRICE_INQUIRY',
    confidence: 0.94,
    entities: validEntities(),
    answer: 'Стоимость зависит от выбранного масла...',
    needsHuman: false,
    reason: null,
    ...overrides,
  }
}

describe('aiResultSchema', () => {
  it('accepts a valid result', () => {
    const result = aiResultSchema.parse(validResult())
    expect(result.intent).toBe('PRICE_INQUIRY')
    expect(result.confidence).toBe(0.94)
  })

  it('accepts every documented intent value', () => {
    const intents = [
      'GENERAL_QUESTION',
      'SERVICE_INQUIRY',
      'PRICE_INQUIRY',
      'AVAILABILITY_INQUIRY',
      'BOOKING_REQUEST',
      'RESCHEDULE_REQUEST',
      'CANCELLATION_REQUEST',
      'VEHICLE_PROBLEM',
      'SERVICE_HISTORY_INQUIRY',
      'WARRANTY_INQUIRY',
      'CUSTOMER_INFORMATION',
      'UNKNOWN',
    ]
    for (const intent of intents) {
      expect(() => aiResultSchema.parse(validResult({ intent }))).not.toThrow()
    }
  })

  it('rejects an invalid/unknown intent', () => {
    expect(() => aiResultSchema.parse(validResult({ intent: 'MAKE_COFFEE' }))).toThrow()
  })

  it('rejects confidence < 0', () => {
    expect(() => aiResultSchema.parse(validResult({ confidence: -0.01 }))).toThrow()
  })

  it('rejects confidence > 1', () => {
    expect(() => aiResultSchema.parse(validResult({ confidence: 1.01 }))).toThrow()
  })

  it('accepts confidence at the 0 and 1 boundaries', () => {
    expect(() => aiResultSchema.parse(validResult({ confidence: 0 }))).not.toThrow()
    expect(() => aiResultSchema.parse(validResult({ confidence: 1 }))).not.toThrow()
  })

  it('rejects a missing answer', () => {
    const { answer: _a, ...withoutAnswer } = validResult()
    expect(() => aiResultSchema.parse(withoutAnswer)).toThrow()
  })

  it('rejects an empty answer', () => {
    expect(() => aiResultSchema.parse(validResult({ answer: '' }))).toThrow()
  })

  it('rejects invalid entities (wrong type)', () => {
    expect(() => aiResultSchema.parse(validResult({ entities: 'not-an-object' }))).toThrow()
  })

  it('rejects invalid entities (unexpected field type)', () => {
    expect(() => aiResultSchema.parse(validResult({ entities: { ...validEntities(), phone: 12345 } }))).toThrow()
  })

  it('rejects a missing intent', () => {
    const { intent: _i, ...withoutIntent } = validResult()
    expect(() => aiResultSchema.parse(withoutIntent)).toThrow()
  })

  it('rejects a missing needsHuman', () => {
    const { needsHuman: _n, ...withoutNeedsHuman } = validResult()
    expect(() => aiResultSchema.parse(withoutNeedsHuman)).toThrow()
  })

  it('treats a blank reason as null', () => {
    const result = aiResultSchema.parse(validResult({ reason: '   ' }))
    expect(result.reason).toBeNull()
  })

  it('defaults reason to null when omitted', () => {
    const { reason: _r, ...withoutReason } = validResult()
    const result = aiResultSchema.parse(withoutReason)
    expect(result.reason).toBeNull()
  })
})

describe('aiEntitiesSchema — entity normalization', () => {
  it('treats empty-string entity values as null, never a guess', () => {
    const result = aiEntitiesSchema.parse({ ...validEntities(), serviceName: '', vehicleMake: '   ' })
    expect(result.serviceName).toBeNull()
    expect(result.vehicleMake).toBeNull()
  })

  it('defaults every field to null when omitted entirely', () => {
    const result = aiEntitiesSchema.parse({})
    expect(result).toEqual({
      customerName: null,
      phone: null,
      vehicleMake: null,
      vehicleModel: null,
      licensePlate: null,
      serviceName: null,
      requestedDate: null,
      requestedTime: null,
    })
  })

  it('trims a real value', () => {
    const result = aiEntitiesSchema.parse({ ...validEntities(), serviceName: '  Замена масла  ' })
    expect(result.serviceName).toBe('Замена масла')
  })
})
