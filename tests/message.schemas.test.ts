import { describe, it, expect } from 'vitest'
import { createMessageSchema } from '../src/server/validation/message.schemas'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    content: 'Здравствуйте, сколько стоит замена масла?',
    ...overrides,
  }
}

describe('createMessageSchema', () => {
  it('accepts a valid payload', () => {
    const result = createMessageSchema.parse(basePayload())
    expect(result.direction).toBe('INBOUND')
    expect(result.senderType).toBe('CUSTOMER')
  })

  it('accepts all documented direction values', () => {
    for (const direction of ['INBOUND', 'OUTBOUND']) {
      expect(() => createMessageSchema.parse(basePayload({ direction }))).not.toThrow()
    }
  })

  it('accepts all documented senderType values', () => {
    for (const senderType of ['CUSTOMER', 'STAFF', 'SYSTEM']) {
      expect(() => createMessageSchema.parse(basePayload({ senderType }))).not.toThrow()
    }
  })

  it('rejects an invalid direction', () => {
    expect(() => createMessageSchema.parse(basePayload({ direction: 'SIDEWAYS' }))).toThrow()
  })

  it('rejects an invalid senderType (AI is deliberately not a valid value at this stage)', () => {
    expect(() => createMessageSchema.parse(basePayload({ senderType: 'AI' }))).toThrow()
  })

  it('rejects a missing content', () => {
    const { content: _c, ...withoutContent } = basePayload()
    expect(() => createMessageSchema.parse(withoutContent)).toThrow()
  })

  it('trims content', () => {
    const result = createMessageSchema.parse(basePayload({ content: '  hello  ' }))
    expect(result.content).toBe('hello')
  })

  it('rejects empty content', () => {
    expect(() => createMessageSchema.parse(basePayload({ content: '' }))).toThrow()
  })

  it('rejects whitespace-only content', () => {
    expect(() => createMessageSchema.parse(basePayload({ content: '   ' }))).toThrow()
  })

  it('rejects content over the max length', () => {
    expect(() => createMessageSchema.parse(basePayload({ content: 'a'.repeat(10001) }))).toThrow()
  })

  it('accepts content at the max length boundary', () => {
    expect(() => createMessageSchema.parse(basePayload({ content: 'a'.repeat(10000) }))).not.toThrow()
  })
})
