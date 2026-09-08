import { describe, it, expect } from 'vitest'
import { analyzeMessageSchema } from '../src/server/validation/ai.schemas'

const CONVERSATION_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('analyzeMessageSchema', () => {
  it('accepts a valid payload', () => {
    const result = analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID, message: 'Сколько стоит замена масла?' })
    expect(result.conversationId).toBe(CONVERSATION_ID)
  })

  it('rejects a missing conversationId', () => {
    expect(() => analyzeMessageSchema.parse({ message: 'hi' })).toThrow()
  })

  it('rejects a non-UUID conversationId', () => {
    expect(() => analyzeMessageSchema.parse({ conversationId: 'not-a-uuid', message: 'hi' })).toThrow()
  })

  it('does NOT accept tenantId/businessId as trusted input — they are simply ignored, never read back', () => {
    const result = analyzeMessageSchema.parse({
      conversationId: CONVERSATION_ID,
      message: 'hi',
      tenantId: 'attacker-supplied',
      businessId: 'attacker-supplied',
    }) as Record<string, unknown>
    expect('tenantId' in result).toBe(false)
    expect('businessId' in result).toBe(false)
  })

  it('rejects a missing message', () => {
    expect(() => analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID })).toThrow()
  })

  it('trims the message', () => {
    const result = analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID, message: '  hi  ' })
    expect(result.message).toBe('hi')
  })

  it('rejects an empty/whitespace-only message', () => {
    expect(() => analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID, message: '   ' })).toThrow()
  })

  it('rejects a message over the max length', () => {
    expect(() => analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID, message: 'a'.repeat(4001) })).toThrow()
  })

  it('accepts a message at the max length boundary', () => {
    expect(() => analyzeMessageSchema.parse({ conversationId: CONVERSATION_ID, message: 'a'.repeat(4000) })).not.toThrow()
  })
})
