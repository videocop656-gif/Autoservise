import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '../src/server/lib/errors'

const mocks = vi.hoisted(() => ({
  findByIdUnscoped: vi.fn(),
  tenantFindById: vi.fn(),
  businessFindFirstByTenant: vi.fn(),
  receiveIncoming: vi.fn(),
}))

vi.mock('../src/server/repositories/channelConnectionRepository', () => ({
  channelConnectionRepository: { findByIdUnscoped: mocks.findByIdUnscoped },
}))
vi.mock('../src/server/repositories/tenantRepository', () => ({
  tenantRepository: { findById: mocks.tenantFindById },
}))
vi.mock('../src/server/repositories/businessRepository', () => ({
  businessRepository: { findFirstByTenant: mocks.businessFindFirstByTenant },
}))
vi.mock('../src/server/services/channelMessageService', () => ({
  receiveIncoming: mocks.receiveIncoming,
}))

import handler from '../api/webhooks/telegram/[connectionId]'
import type { ApiRequest, ApiResponse } from '../src/server/types/http'

function makeRes() {
  const res: { statusCode: number; body: unknown } & Partial<ApiResponse> = { statusCode: 0, body: undefined }
  res.status = vi.fn((code: number) => {
    res.statusCode = code
    return res as ApiResponse
  })
  res.json = vi.fn((data: unknown) => {
    res.body = data
  })
  return res as { statusCode: number; body: unknown } & ApiResponse
}

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    headers: {},
    query: { connectionId: '11111111-1111-1111-1111-111111111111' },
    body: { update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hi' } },
    ...overrides,
  } as ApiRequest
}

const TENANT = { id: 'tenant-a', name: 'T', status: 'trial', createdAt: new Date(), updatedAt: new Date() }
const BUSINESS = { id: 'business-a', tenantId: 'tenant-a', name: 'B', timezone: 'UTC', currency: 'RUB', createdAt: new Date(), updatedAt: new Date() }
const CONNECTION = {
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: 'tenant-a',
  businessId: 'business-a',
  type: 'TELEGRAM',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELEGRAM_WEBHOOK_SECRET = 'correct-secret'
  mocks.findByIdUnscoped.mockResolvedValue(CONNECTION)
  mocks.tenantFindById.mockResolvedValue(TENANT)
  mocks.businessFindFirstByTenant.mockResolvedValue(BUSINESS)
  mocks.receiveIncoming.mockResolvedValue({ conversationId: 'c1', messageId: 'm1', customerId: null, duplicate: false, conversationCreated: true, conversationReopened: false })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('POST /api/webhooks/telegram/:connectionId — secret authentication (spec §16-18, §44)', () => {
  it('missing secret header is rejected 401, never reaching receiveIncoming', async () => {
    const req = makeReq({ headers: {} })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
    expect(mocks.findByIdUnscoped).not.toHaveBeenCalled()
  })

  it('wrong secret is rejected 401, never reaching receiveIncoming', async () => {
    const req = makeReq({ headers: { 'x-telegram-bot-api-secret-token': 'wrong' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
  })

  it('correct secret is accepted and processing proceeds', async () => {
    const req = makeReq({ headers: { 'x-telegram-bot-api-secret-token': 'correct-secret' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(mocks.receiveIncoming).toHaveBeenCalled()
  })

  it('an unconfigured server-side secret (TELEGRAM_WEBHOOK_SECRET unset) fails closed — every request is rejected, never accidentally open', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const req = makeReq({ headers: { 'x-telegram-bot-api-secret-token': 'anything' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
  })

  it('the response never echoes back the secret or any internal id', async () => {
    const req = makeReq({ headers: { 'x-telegram-bot-api-secret-token': 'correct-secret' } })
    const res = makeRes()
    await handler(req, res)
    expect(JSON.stringify(res.body)).not.toContain('correct-secret')
    expect(JSON.stringify(res.body)).not.toContain('tenant-a')
    expect(JSON.stringify(res.body)).not.toContain('business-a')
  })
})

describe('POST /api/webhooks/telegram/:connectionId — routing and processing', () => {
  const validHeaders = { 'x-telegram-bot-api-secret-token': 'correct-secret' }

  it('an unknown connectionId 404s safely, never calling receiveIncoming', async () => {
    mocks.findByIdUnscoped.mockResolvedValue(null)
    const req = makeReq({ headers: validHeaders })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
  })

  it('a malformed (non-uuid) connectionId 404s safely', async () => {
    const req = makeReq({ headers: validHeaders, query: { connectionId: 'not-a-uuid' } })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
  })

  it('a non-TELEGRAM connection id is treated as not found (webhook context resolver rejects it)', async () => {
    mocks.findByIdUnscoped.mockResolvedValue({ ...CONNECTION, type: 'WHATSAPP' })
    const req = makeReq({ headers: validHeaders })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
  })

  it('receiveIncoming is called with the raw request body untouched, and the resolved tenant/business/connection id', async () => {
    const req = makeReq({ headers: validHeaders })
    const res = makeRes()
    await handler(req, res)
    const [ctx, connectionId, rawBody] = mocks.receiveIncoming.mock.calls[0]!
    expect(connectionId).toBe(CONNECTION.id)
    expect(ctx.tenant.id).toBe('tenant-a')
    expect(ctx.business.id).toBe('business-a')
    expect(rawBody).toEqual(req.body)
  })

  it('a classified ApiError from receiveIncoming (e.g. inactive connection, invalid payload) is still ack\'d 200 to Telegram', async () => {
    mocks.receiveIncoming.mockRejectedValue(new ApiError(409, 'CHANNEL_INACTIVE', 'This channel connection is not active'))
    const req = makeReq({ headers: validHeaders })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
  })

  it('an unexpected non-ApiError failure surfaces as 500 (so Telegram retries later), never leaking the raw error to the response', async () => {
    mocks.receiveIncoming.mockRejectedValue(new Error('db connection lost'))
    const req = makeReq({ headers: validHeaders })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('db connection lost')
  })

  it('a non-POST method is rejected safely', async () => {
    const req = makeReq({ headers: validHeaders, method: 'GET' })
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(404)
    expect(mocks.receiveIncoming).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/telegram/:connectionId — multi-tenant routing (spec §21, §44)', () => {
  const validHeaders = { 'x-telegram-bot-api-secret-token': 'correct-secret' }

  it('two different connection ids route to two different, independently-resolved tenants — Bot A never reaches Tenant B', async () => {
    const CONNECTION_B = { ...CONNECTION, id: '22222222-2222-2222-2222-222222222222', tenantId: 'tenant-b', businessId: 'business-b' }
    const TENANT_B = { ...TENANT, id: 'tenant-b' }
    const BUSINESS_B = { ...BUSINESS, id: 'business-b', tenantId: 'tenant-b' }

    mocks.findByIdUnscoped.mockImplementation(async (id: string) => (id === CONNECTION.id ? CONNECTION : CONNECTION_B))
    mocks.tenantFindById.mockImplementation(async (id: string) => (id === 'tenant-a' ? TENANT : TENANT_B))
    mocks.businessFindFirstByTenant.mockImplementation(async (tenantId: string) => (tenantId === 'tenant-a' ? BUSINESS : BUSINESS_B))

    const reqA = makeReq({ headers: validHeaders, query: { connectionId: CONNECTION.id } })
    await handler(reqA, makeRes())
    const ctxA = mocks.receiveIncoming.mock.calls[0]![0]
    expect(ctxA.tenant.id).toBe('tenant-a')

    mocks.receiveIncoming.mockClear()
    const reqB = makeReq({ headers: validHeaders, query: { connectionId: CONNECTION_B.id } })
    await handler(reqB, makeRes())
    const ctxB = mocks.receiveIncoming.mock.calls[0]![0]
    expect(ctxB.tenant.id).toBe('tenant-b')
  })
})
