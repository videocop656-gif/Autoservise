import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/server/lib/env', () => ({
  env: { sessionSecret: 'test-secret' },
  SESSION_COOKIE_NAME: 'session_token',
  SESSION_DURATION_MS: 1000 * 60 * 60,
}))

vi.mock('../src/server/repositories/sessionRepository', () => ({
  sessionRepository: {
    findByTokenHash: vi.fn(),
    touch: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../src/server/repositories/userRepository', () => ({
  userRepository: { findById: vi.fn() },
}))
vi.mock('../src/server/repositories/tenantRepository', () => ({
  tenantRepository: { findById: vi.fn() },
}))

import { requireAuth } from '../src/server/middleware/requireAuth'
import { sessionRepository } from '../src/server/repositories/sessionRepository'
import { userRepository } from '../src/server/repositories/userRepository'
import { tenantRepository } from '../src/server/repositories/tenantRepository'
import { ApiError } from '../src/server/lib/errors'
import type { ApiRequest } from '../src/server/types/http'

function makeRequest(cookies: Record<string, string>): ApiRequest {
  return { cookies } as unknown as ApiRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(sessionRepository.touch).mockResolvedValue(undefined as never)
})

describe('requireAuth', () => {
  it('throws 401 when no session cookie is present', async () => {
    await expect(requireAuth(makeRequest({}))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when the session does not exist', async () => {
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue(null)
    await expect(requireAuth(makeRequest({ session_token: 'abc' }))).rejects.toBeInstanceOf(ApiError)
  })

  it('throws 401 when the session is expired', async () => {
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      lastUsedAt: new Date(),
    } as never)
    await expect(requireAuth(makeRequest({ session_token: 'abc' }))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when the session is valid but the user no longer exists', async () => {
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 100000),
      createdAt: new Date(),
      lastUsedAt: new Date(),
    } as never)
    vi.mocked(userRepository.findById).mockResolvedValue(null)
    await expect(requireAuth(makeRequest({ session_token: 'abc' }))).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns a safe auth context for a valid session', async () => {
    vi.mocked(sessionRepository.findByTokenHash).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 100000),
      createdAt: new Date(),
      lastUsedAt: new Date(),
    } as never)
    vi.mocked(userRepository.findById).mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'x',
      name: 'A',
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
    vi.mocked(tenantRepository.findById).mockResolvedValue({
      id: 't1',
      name: 'Tenant',
      status: 'trial',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const ctx = await requireAuth(makeRequest({ session_token: 'abc' }))
    expect(ctx.user.email).toBe('a@b.com')
    expect(ctx.user).not.toHaveProperty('passwordHash')
    expect(ctx.tenant.id).toBe('t1')
  })
})
