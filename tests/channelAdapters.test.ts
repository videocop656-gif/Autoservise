import { describe, it, expect } from 'vitest'
import { getChannelAdapter } from '../src/server/channels/channelAdapterRegistry'
import { createMockAdapter } from '../src/server/channels/adapters/mockAdapter'
import { channelTypeToConversationChannel } from '../src/server/channels/types'

describe('channelAdapterRegistry', () => {
  it('returns an adapter for every ChannelType, stamped with the right channelType', () => {
    for (const type of ['TELEGRAM', 'WHATSAPP', 'WEBSITE'] as const) {
      const adapter = getChannelAdapter(type)
      expect(adapter.channelType).toBe(type)
    }
  })
})

describe('createMockAdapter — never a real network call', () => {
  it('parseIncoming normalizes a plain test payload, stamping channelType', () => {
    const adapter = createMockAdapter('TELEGRAM')
    const normalized = adapter.parseIncoming({
      externalMessageId: 'm1',
      externalConversationId: 'c1',
      text: 'hi',
      sentAt: '2026-01-01T00:00:00Z',
    })
    expect(normalized).toMatchObject({ channelType: 'TELEGRAM', externalMessageId: 'm1', externalConversationId: 'c1', text: 'hi' })
    expect(normalized.sentAt).toBeInstanceOf(Date)
  })

  it('sendMessage always resolves (never throws, never touches the network) and returns a deterministic mock id on success', async () => {
    const adapter = createMockAdapter('WHATSAPP')
    const result = await adapter.sendMessage({ channelType: 'WHATSAPP', externalConversationId: 'c1', content: 'Hello' })
    expect(result.success).toBe(true)
    expect(result.externalMessageId).toMatch(/^mock-out-/)
  })

  it('sendMessage returns a controlled, retryable failure for the magic test string, never a thrown error', async () => {
    const adapter = createMockAdapter('WEBSITE')
    const result = await adapter.sendMessage({ channelType: 'WEBSITE', externalConversationId: 'c1', content: '__mock_send_failure__' })
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBeTruthy()
    expect(result.retryable).toBe(true)
  })
})

describe('channelTypeToConversationChannel', () => {
  it('maps every ChannelType 1:1 by name onto ConversationChannel', () => {
    expect(channelTypeToConversationChannel('TELEGRAM')).toBe('TELEGRAM')
    expect(channelTypeToConversationChannel('WHATSAPP')).toBe('WHATSAPP')
    expect(channelTypeToConversationChannel('WEBSITE')).toBe('WEBSITE')
  })
})
