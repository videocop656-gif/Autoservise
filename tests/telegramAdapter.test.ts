import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTelegramAdapter } from '../src/server/channels/adapters/telegramAdapter'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('TelegramChannelAdapter.parseIncoming — spec §9-14', () => {
  const adapter = createTelegramAdapter('fake-token')

  it('a valid private-chat text update normalizes correctly, with deterministic ids', () => {
    const result = adapter.parseIncoming({
      update_id: 100,
      message: {
        message_id: 55,
        date: 1735689600,
        chat: { id: 999, type: 'private' },
        from: { id: 123, first_name: 'Ivan', last_name: 'Petrov', username: 'ivanp' },
        text: 'Здравствуйте!',
      },
    })
    expect(result).toMatchObject({
      channelType: 'TELEGRAM',
      externalMessageId: 'telegram:999:55',
      externalConversationId: '999',
      externalCustomerId: '123',
      customerName: 'Ivan Petrov',
      text: 'Здравствуйте!',
    })
    expect(result.sentAt).toEqual(new Date(1735689600 * 1000))
    // Telegram username/display name is transient metadata only — never a phone.
    expect(result.customerPhone).toBeUndefined()
  })

  it('the same (chatId, messageId) pair always produces the same externalMessageId — never a random UUID', () => {
    const payload = { message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hi' } }
    const a = adapter.parseIncoming(payload)
    const b = adapter.parseIncoming(payload)
    expect(a.externalMessageId).toBe(b.externalMessageId)
    expect(a.externalMessageId).toBe('telegram:1:1')
  })

  it('a missing message.text (photo/voice/sticker/etc.) produces an empty-text result — never fabricated content like "[photo]"', () => {
    const result = adapter.parseIncoming({
      message: { message_id: 2, date: 1, chat: { id: 5, type: 'private' }, from: { id: 9 }, photo: [{ file_id: 'abc' }] },
    })
    expect(result.text).toBe('')
    expect(result.externalMessageId).toBe('telegram:5:2')
  })

  it('a group/supergroup chat is rejected as unsupported (empty text), never creating a Conversation for it', () => {
    const result = adapter.parseIncoming({
      message: { message_id: 3, date: 1, chat: { id: 7, type: 'group' }, from: { id: 9 }, text: 'hello from a group' },
    })
    expect(result.text).toBe('')
  })

  it('a channel post / edited message / any update without .message is safely unsupported, never throws', () => {
    expect(() => adapter.parseIncoming({ update_id: 1, edited_message: { message_id: 1 } })).not.toThrow()
    expect(adapter.parseIncoming({ update_id: 1, edited_message: { message_id: 1 } }).text).toBe('')
  })

  it('malformed / non-object payloads never throw', () => {
    expect(() => adapter.parseIncoming('not json' as unknown)).not.toThrow()
    expect(() => adapter.parseIncoming(null)).not.toThrow()
    expect(() => adapter.parseIncoming(undefined)).not.toThrow()
    expect(adapter.parseIncoming('garbage').text).toBe('')
  })

  it('a message with no from (e.g. anonymous admin) leaves externalCustomerId/customerName undefined rather than crashing', () => {
    const result = adapter.parseIncoming({ message: { message_id: 4, date: 1, chat: { id: 8, type: 'private' }, text: 'hi' } })
    expect(result.externalCustomerId).toBeUndefined()
    expect(result.customerName).toBeUndefined()
    expect(result.text).toBe('hi')
  })
})

describe('TelegramChannelAdapter.sendMessage — spec §26-28', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('a successful Telegram sendMessage returns the real message_id as externalMessageId', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 4321 } }))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '999', content: 'Hello!' })
    expect(result).toEqual({ success: true, externalMessageId: '4321' })
  })

  it('chat_id/text are exactly what was passed through — never re-derived, never a client-controlled override', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 1 } }))
    const adapter = createTelegramAdapter('secret-token-value')
    await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '555', content: 'Test content' })
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]!
    expect(String(url)).toBe('https://api.telegram.org/botsecret-token-value/sendMessage')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ chat_id: '555', text: 'Test content' })
  })

  it('a message over 4096 characters is rejected BEFORE calling Telegram — never silently truncated', async () => {
    const adapter = createTelegramAdapter('fake-token')
    const longContent = 'a'.repeat(4097)
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: longContent })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_BAD_REQUEST', retryable: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a 401 from Telegram classifies as TELEGRAM_AUTH_ERROR, not retryable, and never leaks the token in the error message', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(401, { ok: false, error_code: 401, description: 'Unauthorized' }))
    const adapter = createTelegramAdapter('super-secret-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_AUTH_ERROR', retryable: false })
    expect(result.errorMessage).not.toContain('super-secret-token')
  })

  it('a 429 from Telegram classifies as TELEGRAM_RATE_LIMITED and IS retryable', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests' }))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_RATE_LIMITED', retryable: true })
  })

  it('a 404 from Telegram (unknown chat) classifies as TELEGRAM_NOT_FOUND', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(404, { ok: false, error_code: 404, description: 'Not Found' }))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_NOT_FOUND' })
  })

  it('a 400 from Telegram classifies as TELEGRAM_BAD_REQUEST', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_BAD_REQUEST' })
  })

  it('a network failure (fetch throws) classifies as TELEGRAM_NETWORK_ERROR and is retryable, never a thrown exception', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('ECONNRESET'))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result).toMatchObject({ success: false, errorCode: 'TELEGRAM_NETWORK_ERROR', retryable: true })
    expect(result.errorMessage).not.toContain('ECONNRESET')
  })

  it('never returns a raw Telegram JSON body as the error message', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse(400, { ok: false, error_code: 400, description: 'some internal detail: SELECT * FROM users' }))
    const adapter = createTelegramAdapter('fake-token')
    const result = await adapter.sendMessage({ channelType: 'TELEGRAM', externalConversationId: '1', content: 'hi' })
    expect(result.errorMessage).not.toContain('SELECT')
  })
})
