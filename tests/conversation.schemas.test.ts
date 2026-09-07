import { describe, it, expect } from 'vitest'
import {
  createConversationSchema,
  updateConversationSchema,
  conversationIdParamSchema,
} from '../src/server/validation/conversation.schemas'

const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174000'
const REQUEST_ID = '223e4567-e89b-12d3-a456-426614174000'

describe('createConversationSchema', () => {
  it('accepts a minimal valid payload (channel only)', () => {
    const result = createConversationSchema.parse({ channel: 'MANUAL' })
    expect(result.channel).toBe('MANUAL')
    expect(result.customerId).toBeUndefined()
  })

  it('rejects a missing channel', () => {
    expect(() => createConversationSchema.parse({})).toThrow()
  })

  it('rejects an invalid channel', () => {
    expect(() => createConversationSchema.parse({ channel: 'EMAIL' })).toThrow()
  })

  it('accepts all documented channel values', () => {
    for (const channel of ['MANUAL', 'WEBSITE', 'TELEGRAM', 'WHATSAPP', 'PHONE', 'OTHER']) {
      expect(() => createConversationSchema.parse({ channel })).not.toThrow()
    }
  })

  it('accepts optional customerId/customerRequestId', () => {
    const result = createConversationSchema.parse({ channel: 'PHONE', customerId: CUSTOMER_ID, customerRequestId: REQUEST_ID })
    expect(result.customerId).toBe(CUSTOMER_ID)
    expect(result.customerRequestId).toBe(REQUEST_ID)
  })

  it('treats empty-string customerId/customerRequestId as null', () => {
    const result = createConversationSchema.parse({ channel: 'PHONE', customerId: '', customerRequestId: '' })
    expect(result.customerId).toBeNull()
    expect(result.customerRequestId).toBeNull()
  })

  it('rejects an invalid customerId', () => {
    expect(() => createConversationSchema.parse({ channel: 'PHONE', customerId: 'not-a-uuid' })).toThrow()
  })

  it('accepts an optional subject, trims it, rejects over max length', () => {
    expect(createConversationSchema.parse({ channel: 'PHONE', subject: '  Hi  ' }).subject).toBe('Hi')
    expect(() => createConversationSchema.parse({ channel: 'PHONE', subject: 'a'.repeat(201) })).toThrow()
  })

  it('treats a blank subject as null', () => {
    expect(createConversationSchema.parse({ channel: 'PHONE', subject: '   ' }).subject).toBeNull()
  })

  it('accepts an optional startedAt as a valid ISO 8601 datetime, transformed to a Date', () => {
    const result = createConversationSchema.parse({ channel: 'PHONE', startedAt: '2026-09-08T09:00:00Z' })
    expect(result.startedAt).toBeInstanceOf(Date)
  })

  it('rejects an invalid startedAt', () => {
    expect(() => createConversationSchema.parse({ channel: 'PHONE', startedAt: 'not-a-date' })).toThrow()
  })

  it('rejects a startedAt without a timezone offset', () => {
    expect(() => createConversationSchema.parse({ channel: 'PHONE', startedAt: '2026-09-08T09:00:00' })).toThrow()
  })
})

describe('updateConversationSchema', () => {
  it('accepts a status-only update', () => {
    expect(() => updateConversationSchema.parse({ status: 'CLOSED' })).not.toThrow()
  })

  it('rejects an invalid status', () => {
    expect(() => updateConversationSchema.parse({ status: 'ARCHIVED' })).toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateConversationSchema.parse({})).toThrow()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateConversationSchema.parse({ status: 'CLOSED' }) as Record<string, unknown>
    expect('subject' in result).toBe(false)
    expect('customerId' in result).toBe(false)
  })

  it('allows clearing customerId/customerRequestId to null', () => {
    const result = updateConversationSchema.parse({ customerId: null, customerRequestId: null })
    expect(result.customerId).toBeNull()
    expect(result.customerRequestId).toBeNull()
  })

  it('accepts an explicit closedAt', () => {
    const result = updateConversationSchema.parse({ status: 'CLOSED', closedAt: '2026-09-08T10:00:00Z' })
    expect(result.closedAt).toBeInstanceOf(Date)
  })

  it('accepts closedAt: null (explicit clear)', () => {
    const result = updateConversationSchema.parse({ status: 'OPEN', closedAt: null })
    expect(result.closedAt).toBeNull()
  })
})

describe('conversationIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => conversationIdParamSchema.parse(CUSTOMER_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => conversationIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
