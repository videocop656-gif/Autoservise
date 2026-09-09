import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { makeAuthContext } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  updateById: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: mocks,
}))

import {
  listChannelConnections,
  getChannelConnection,
  createChannelConnection,
  updateChannelConnection,
  activateChannelConnection,
  deactivateChannelConnection,
} from '../src/server/services/channelConnectionService'

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 't1',
    businessId: 'b1',
    type: 'TELEGRAM',
    status: 'INACTIVE',
    displayName: 'My Bot',
    externalAccountId: 'my_bot',
    config: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listChannelConnections / getChannelConnection — everyone can read', () => {
  it('owner, admin, and manager can all list', async () => {
    mocks.list.mockResolvedValue([])
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(listChannelConnections(makeAuthContext(role))).resolves.toEqual([])
    }
  })

  it('getChannelConnection 404s (CHANNEL_NOT_FOUND) for a foreign/unknown id', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(getChannelConnection(makeAuthContext('manager'), 'missing')).rejects.toMatchObject({
      statusCode: 404,
      code: 'CHANNEL_NOT_FOUND',
    })
  })
})

describe('createChannelConnection — permissions and defaults', () => {
  it('manager cannot create', async () => {
    await expect(
      createChannelConnection(makeAuthContext('manager'), { type: 'TELEGRAM', displayName: 'X', externalAccountId: 'x' })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('owner and admin can both create', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    for (const role of ['owner', 'admin'] as const) {
      await expect(
        createChannelConnection(makeAuthContext(role), { type: 'TELEGRAM', displayName: 'X', externalAccountId: 'x' })
      ).resolves.toBeDefined()
    }
  })

  it('a new connection always starts INACTIVE, regardless of what the caller might wish', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    await createChannelConnection(makeAuthContext('owner'), { type: 'TELEGRAM', displayName: 'X', externalAccountId: 'x' })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'INACTIVE' }))
  })

  it('scopes the new connection to the creator\'s own tenant/business, never client-supplied ones', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    const ctx = makeAuthContext('owner')
    await createChannelConnection(ctx, { type: 'WHATSAPP', displayName: 'X', externalAccountId: 'x' })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ctx.tenant.id, businessId: ctx.business.id }))
  })

  it('strips secret-shaped config keys — token/secret/key/password/credential/auth never survive', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    await createChannelConnection(makeAuthContext('owner'), {
      type: 'TELEGRAM',
      displayName: 'X',
      externalAccountId: 'x',
      config: { botToken: 'sk-secret', apiKey: 'abc', webhookSecret: 'xyz', password: 'p', authHeader: 'h', region: 'eu' },
    })
    const call = mocks.create.mock.calls[0]![0] as { config: Record<string, unknown> }
    expect(call.config).toEqual({ region: 'eu' })
  })

  it('drops nested object/array config values, keeping only primitives', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    await createChannelConnection(makeAuthContext('owner'), {
      type: 'TELEGRAM',
      displayName: 'X',
      externalAccountId: 'x',
      config: { nested: { a: 1 } as unknown as string, flag: true, count: 3 },
    })
    const call = mocks.create.mock.calls[0]![0] as { config: Record<string, unknown> }
    expect(call.config).toEqual({ flag: true, count: 3 })
  })

  it('omits config entirely when nothing survives sanitization', async () => {
    mocks.create.mockResolvedValue(makeConnection())
    await createChannelConnection(makeAuthContext('owner'), {
      type: 'TELEGRAM',
      displayName: 'X',
      externalAccountId: 'x',
      config: { token: 'x' },
    })
    const call = mocks.create.mock.calls[0]![0] as { config: unknown }
    expect(call.config).toBeUndefined()
  })

  it('duplicate (tenant, business, type, externalAccountId) maps a real P2002 to a safe 409, never a raw DB error', async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }))
    await expect(
      createChannelConnection(makeAuthContext('owner'), { type: 'TELEGRAM', displayName: 'X', externalAccountId: 'dup' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CHANNEL_ALREADY_EXISTS' })
  })
})

describe('updateChannelConnection — profile fields only', () => {
  it('manager cannot update', async () => {
    await expect(updateChannelConnection(makeAuthContext('manager'), 'x', { displayName: 'Y' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('owner/admin can update displayName/externalAccountId/config', async () => {
    mocks.findById.mockResolvedValue(makeConnection())
    mocks.updateById.mockResolvedValue(makeConnection({ displayName: 'New' }))
    await expect(updateChannelConnection(makeAuthContext('owner'), 'conn-1', { displayName: 'New' })).resolves.toMatchObject({ displayName: 'New' })
  })

  it('never accepts/changes tenantId/businessId/status through this path', async () => {
    mocks.findById.mockResolvedValue(makeConnection())
    mocks.updateById.mockResolvedValue(makeConnection())
    await updateChannelConnection(makeAuthContext('owner'), 'conn-1', { displayName: 'New' })
    const call = mocks.updateById.mock.calls[0]![3] as Record<string, unknown>
    expect(Object.keys(call)).not.toContain('tenantId')
    expect(Object.keys(call)).not.toContain('businessId')
    expect(Object.keys(call)).not.toContain('status')
  })

  it('sanitizes config on update too', async () => {
    mocks.findById.mockResolvedValue(makeConnection())
    mocks.updateById.mockResolvedValue(makeConnection())
    await updateChannelConnection(makeAuthContext('owner'), 'conn-1', { config: { secretKey: 'x', locale: 'ru' } })
    const call = mocks.updateById.mock.calls[0]![3] as { config: Record<string, unknown> }
    expect(call.config).toEqual({ locale: 'ru' })
  })

  it('foreign/unknown target 404s (CHANNEL_NOT_FOUND)', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(updateChannelConnection(makeAuthContext('owner'), 'missing', { displayName: 'X' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'CHANNEL_NOT_FOUND',
    })
  })
})

describe('activate / deactivate', () => {
  it('manager cannot activate or deactivate', async () => {
    await expect(activateChannelConnection(makeAuthContext('manager'), 'x')).rejects.toMatchObject({ statusCode: 403 })
    await expect(deactivateChannelConnection(makeAuthContext('manager'), 'x')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('owner/admin can activate', async () => {
    mocks.findById.mockResolvedValue(makeConnection())
    mocks.setStatus.mockResolvedValue(makeConnection({ status: 'ACTIVE' }))
    await expect(activateChannelConnection(makeAuthContext('admin'), 'conn-1')).resolves.toMatchObject({ status: 'ACTIVE' })
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'conn-1', 'ACTIVE')
  })

  it('owner/admin can deactivate', async () => {
    mocks.findById.mockResolvedValue(makeConnection({ status: 'ACTIVE' }))
    mocks.setStatus.mockResolvedValue(makeConnection({ status: 'INACTIVE' }))
    await expect(deactivateChannelConnection(makeAuthContext('owner'), 'conn-1')).resolves.toMatchObject({ status: 'INACTIVE' })
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'conn-1', 'INACTIVE')
  })

  it('deactivation never calls anything beyond setStatus — no cascading delete of any kind', async () => {
    mocks.findById.mockResolvedValue(makeConnection({ status: 'ACTIVE' }))
    mocks.setStatus.mockResolvedValue(makeConnection({ status: 'INACTIVE' }))
    await deactivateChannelConnection(makeAuthContext('owner'), 'conn-1')
    expect(mocks.setStatus).toHaveBeenCalledTimes(1)
  })

  it('foreign/unknown target 404s for both actions', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(activateChannelConnection(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
    await expect(deactivateChannelConnection(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})
