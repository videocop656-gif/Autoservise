import { describe, it, expect } from 'vitest'
import {
  createChannelConnectionSchema,
  updateChannelConnectionSchema,
  inboundChannelPayloadSchema,
  outboundChannelPayloadSchema,
  channelIdParamSchema,
} from '../src/server/validation/channel.schemas'

describe('createChannelConnectionSchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(() => createChannelConnectionSchema.parse({ type: 'TELEGRAM', displayName: 'My Bot', externalAccountId: 'bot1' })).not.toThrow()
  })

  it('rejects an invalid channel type', () => {
    expect(() => createChannelConnectionSchema.parse({ type: 'SMS', displayName: 'X', externalAccountId: 'x' })).toThrow()
  })

  it('rejects a missing externalAccountId (required, per spec §"CHANNEL CREATE")', () => {
    expect(() => createChannelConnectionSchema.parse({ type: 'TELEGRAM', displayName: 'X' })).toThrow()
  })

  it('never accepts tenantId/businessId/status — they are silently stripped, not merely ignored by convention', () => {
    const parsed = createChannelConnectionSchema.parse({
      type: 'TELEGRAM',
      displayName: 'X',
      externalAccountId: 'x',
      tenantId: 'foreign',
      businessId: 'foreign',
      status: 'ACTIVE',
    } as never)
    expect(parsed).not.toHaveProperty('tenantId')
    expect(parsed).not.toHaveProperty('businessId')
    expect(parsed).not.toHaveProperty('status')
  })

  it('accepts a config object of primitive values only', () => {
    expect(() =>
      createChannelConnectionSchema.parse({ type: 'WEBSITE', displayName: 'X', externalAccountId: 'x', config: { locale: 'ru', widgetVersion: 2, embedded: true } })
    ).not.toThrow()
  })

  it('rejects a nested object as a config value', () => {
    expect(() =>
      createChannelConnectionSchema.parse({ type: 'WEBSITE', displayName: 'X', externalAccountId: 'x', config: { nested: { a: 1 } } })
    ).toThrow()
  })
})

describe('updateChannelConnectionSchema', () => {
  it('requires at least one field', () => {
    expect(() => updateChannelConnectionSchema.parse({})).toThrow()
  })

  it('never accepts tenantId/businessId/status', () => {
    const parsed = updateChannelConnectionSchema.parse({ displayName: 'X', status: 'ACTIVE', tenantId: 'foreign' } as never)
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('tenantId')
  })
})

describe('inboundChannelPayloadSchema', () => {
  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      externalMessageId: 'ext-msg-1',
      externalConversationId: 'ext-conv-1',
      text: 'Hello there',
      sentAt: '2026-01-01T00:00:00Z',
      ...overrides,
    }
  }

  it('accepts a minimal valid payload', () => {
    expect(() => inboundChannelPayloadSchema.parse(validPayload())).not.toThrow()
  })

  it('never accepts tenantId/businessId/customerId/conversationId — always silently stripped', () => {
    const parsed = inboundChannelPayloadSchema.parse(
      validPayload({ tenantId: 'foreign', businessId: 'foreign', customerId: 'foreign', conversationId: 'foreign' }) as never
    )
    expect(parsed).not.toHaveProperty('tenantId')
    expect(parsed).not.toHaveProperty('businessId')
    expect(parsed).not.toHaveProperty('customerId')
    expect(parsed).not.toHaveProperty('conversationId')
  })

  it('rejects empty text', () => {
    expect(() => inboundChannelPayloadSchema.parse(validPayload({ text: '' }))).toThrow()
  })

  it('rejects text over 10000 characters', () => {
    expect(() => inboundChannelPayloadSchema.parse(validPayload({ text: 'x'.repeat(10001) }))).toThrow()
  })

  it('accepts exactly 10000 characters', () => {
    expect(() => inboundChannelPayloadSchema.parse(validPayload({ text: 'x'.repeat(10000) }))).not.toThrow()
  })

  it('trims text', () => {
    const parsed = inboundChannelPayloadSchema.parse(validPayload({ text: '  hi  ' }))
    expect(parsed.text).toBe('hi')
  })

  it('rejects a missing sentAt', () => {
    const { sentAt, ...rest } = validPayload()
    expect(() => inboundChannelPayloadSchema.parse(rest)).toThrow()
  })

  it('rejects an invalid customerEmail', () => {
    expect(() => inboundChannelPayloadSchema.parse(validPayload({ customerEmail: 'not-an-email' }))).toThrow()
  })

  it('coerces sentAt to a real Date', () => {
    const parsed = inboundChannelPayloadSchema.parse(validPayload())
    expect(parsed.sentAt).toBeInstanceOf(Date)
  })
})

describe('outboundChannelPayloadSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => outboundChannelPayloadSchema.parse({ conversationId: '11111111-1111-1111-1111-111111111111', text: 'Hi' })).not.toThrow()
  })

  it('rejects a non-uuid conversationId', () => {
    expect(() => outboundChannelPayloadSchema.parse({ conversationId: 'not-a-uuid', text: 'Hi' })).toThrow()
  })
})

describe('channelIdParamSchema', () => {
  it('accepts a valid uuid', () => {
    expect(() => channelIdParamSchema.parse('11111111-1111-1111-1111-111111111111')).not.toThrow()
  })
  it('rejects a non-uuid', () => {
    expect(() => channelIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
