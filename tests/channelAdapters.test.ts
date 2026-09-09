import { describe, it, expect, afterEach } from 'vitest'
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

describe('channelAdapterRegistry — real Telegram Channel Integration (Prompt 18)', () => {
  const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN
  })

  it('with no TELEGRAM_BOT_TOKEN configured, TELEGRAM still returns the mock adapter — every pre-existing test/foundation flow keeps working unchanged', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const adapter = getChannelAdapter('TELEGRAM')
    // The mock's own deterministic id format proves this is the mock, not the real adapter (which returns Telegram's numeric message_id).
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: 'c1', content: 'hi' })
    expect(result.externalMessageId).toMatch(/^mock-out-/)
  })

  it('with TELEGRAM_BOT_TOKEN configured, TELEGRAM returns a real TelegramChannelAdapter instead of the mock', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-test-token'
    const adapter = getChannelAdapter('TELEGRAM')
    // parseIncoming on a genuine Telegram Update shape only works on the real adapter — the mock would instead read (and fail to find) mock-shaped fields.
    const normalized = adapter.parseIncoming({
      update_id: 1,
      message: { message_id: 5, date: 1735689600, chat: { id: 42, type: 'private' }, from: { id: 7 }, text: 'hi' },
    })
    expect(normalized).toMatchObject({ externalMessageId: 'telegram:42:5', externalConversationId: '42', externalCustomerId: '7', text: 'hi' })
  })

  it('WEBSITE/WHATSAPP remain mock-only regardless of TELEGRAM_BOT_TOKEN — Prompt 18 is explicitly Telegram-only, never WhatsApp', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'fake-test-token'
    for (const type of ['WEBSITE', 'WHATSAPP'] as const) {
      const result = await getChannelAdapter(type).sendMessage({ channelType: type, externalConversationId: 'c1', content: 'hi' })
      expect(result.externalMessageId).toMatch(/^mock-out-/)
    }
  })
})
