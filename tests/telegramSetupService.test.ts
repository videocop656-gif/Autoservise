import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAuthContext } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  updateById: vi.fn(),
  setStatus: vi.fn(),
  findOtherActive: vi.fn(),
  getMe: vi.fn(),
  setWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: {
    findById: mocks.findById,
    updateById: mocks.updateById,
    setStatus: mocks.setStatus,
    findOtherActiveByTypeAndExternalAccountId: mocks.findOtherActive,
  },
}))
vi.mock('../src/server/channels/adapters/telegram/telegramApiClient', async () => {
  const actual = await vi.importActual<typeof import('../src/server/channels/adapters/telegram/telegramApiClient')>(
    '../src/server/channels/adapters/telegram/telegramApiClient'
  )
  return {
    ...actual,
    telegramApiClient: { getMe: mocks.getMe, setWebhook: mocks.setWebhook, deleteWebhook: mocks.deleteWebhook },
  }
})

import { setupTelegramConnection, bestEffortDeleteTelegramWebhook } from '../src/server/services/telegramSetupService'
import { TelegramApiError } from '../src/server/channels/adapters/telegram/telegramApiClient'

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 't1',
    businessId: 'b1',
    type: 'TELEGRAM',
    status: 'INACTIVE',
    displayName: 'My Bot',
    externalAccountId: 'placeholder',
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_BOT_TOKEN = 'fake-token'
  process.env.TELEGRAM_WEBHOOK_SECRET = 'fake-secret'
  process.env.APP_URL = 'https://app.example.com'
  mocks.findById.mockResolvedValue(makeConnection())
  mocks.findOtherActive.mockResolvedValue(null)
  mocks.getMe.mockResolvedValue({ id: 555, is_bot: true, username: 'my_real_bot' })
  mocks.setWebhook.mockResolvedValue(true)
  mocks.updateById.mockResolvedValue(makeConnection({ externalAccountId: '555' }))
  mocks.setStatus.mockResolvedValue(makeConnection({ externalAccountId: '555', status: 'ACTIVE' }))
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('setupTelegramConnection', () => {
  it('happy path: getMe -> no conflict -> setWebhook -> persists real externalAccountId -> activates', async () => {
    const result = await setupTelegramConnection(makeAuthContext('owner'), 'conn-1')
    expect(mocks.getMe).toHaveBeenCalledWith('fake-token')
    expect(mocks.setWebhook).toHaveBeenCalledWith('fake-token', 'https://app.example.com/api/webhooks/telegram/conn-1', 'fake-secret')
    expect(mocks.updateById).toHaveBeenCalledWith('t1', 'b1', 'conn-1', expect.objectContaining({ externalAccountId: '555' }))
    expect(mocks.setStatus).toHaveBeenCalledWith('t1', 'b1', 'conn-1', 'ACTIVE')
    expect(result.botUsername).toBe('my_real_bot')
  })

  it('manager cannot run setup (owner/admin only, same as channel management)', async () => {
    await expect(setupTelegramConnection(makeAuthContext('manager'), 'conn-1')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.getMe).not.toHaveBeenCalled()
  })

  it('unknown connection 404s, never calls Telegram', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404, code: 'CHANNEL_NOT_FOUND' })
    expect(mocks.getMe).not.toHaveBeenCalled()
  })

  it('a non-TELEGRAM connection is rejected, never calls Telegram', async () => {
    mocks.findById.mockResolvedValue(makeConnection({ type: 'WHATSAPP' }))
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 409, code: 'CHANNEL_TYPE_MISMATCH' })
    expect(mocks.getMe).not.toHaveBeenCalled()
  })

  it('missing TELEGRAM_BOT_TOKEN fails with a safe CHANNEL_CONFIGURATION_ERROR, never calls Telegram', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 503, code: 'CHANNEL_CONFIGURATION_ERROR' })
    expect(mocks.getMe).not.toHaveBeenCalled()
  })

  it('missing TELEGRAM_WEBHOOK_SECRET fails with a safe CHANNEL_CONFIGURATION_ERROR, never calls Telegram', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 503, code: 'CHANNEL_CONFIGURATION_ERROR' })
    expect(mocks.getMe).not.toHaveBeenCalled()
  })

  it('an invalid token (getMe fails) never activates the connection', async () => {
    mocks.getMe.mockRejectedValue(new TelegramApiError('TELEGRAM_AUTH_ERROR', 'Telegram API request failed (getMe)', false))
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 502, code: 'TELEGRAM_AUTH_ERROR' })
    expect(mocks.setWebhook).not.toHaveBeenCalled()
    expect(mocks.setStatus).not.toHaveBeenCalled()
  })

  it('a setWebhook failure never activates the connection', async () => {
    mocks.setWebhook.mockRejectedValue(new TelegramApiError('TELEGRAM_PROVIDER_ERROR', 'Telegram API request failed (setWebhook)', true))
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 502, code: 'TELEGRAM_PROVIDER_ERROR' })
    expect(mocks.setStatus).not.toHaveBeenCalled()
  })

  it('the same bot already ACTIVE for another tenant is refused with a generic, non-identifying error — no setWebhook attempt', async () => {
    mocks.findOtherActive.mockResolvedValue({ id: 'someone-elses-connection' })
    const err = await setupTelegramConnection(makeAuthContext('owner'), 'conn-1').catch((e) => e)
    expect(err).toMatchObject({ statusCode: 409, code: 'CHANNEL_ALREADY_EXISTS' })
    expect(err.message).not.toContain('someone-elses-connection')
    expect(mocks.setWebhook).not.toHaveBeenCalled()
  })

  it('a non-HTTPS APP_URL is rejected before ever calling setWebhook (spec §37)', async () => {
    process.env.APP_URL = 'http://localhost:5173'
    await expect(setupTelegramConnection(makeAuthContext('owner'), 'conn-1')).rejects.toMatchObject({ statusCode: 503, code: 'CHANNEL_CONFIGURATION_ERROR' })
    expect(mocks.setWebhook).not.toHaveBeenCalled()
  })

  it('never persists the bot token or webhook secret anywhere in the update payload', async () => {
    await setupTelegramConnection(makeAuthContext('owner'), 'conn-1')
    const updateCall = mocks.updateById.mock.calls[0]![3] as Record<string, unknown>
    expect(JSON.stringify(updateCall)).not.toContain('fake-token')
    expect(JSON.stringify(updateCall)).not.toContain('fake-secret')
  })
})

describe('bestEffortDeleteTelegramWebhook', () => {
  it('never throws even when deleteWebhook fails', async () => {
    mocks.deleteWebhook.mockRejectedValue(new Error('network error'))
    await expect(bestEffortDeleteTelegramWebhook('fake-token')).resolves.toBeUndefined()
  })

  it('calls deleteWebhook with the given token on success', async () => {
    mocks.deleteWebhook.mockResolvedValue(true)
    await bestEffortDeleteTelegramWebhook('fake-token')
    expect(mocks.deleteWebhook).toHaveBeenCalledWith('fake-token')
  })
})
