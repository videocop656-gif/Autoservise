import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/server/lib/env', () => ({
  env: { sessionSecret: 'test-secret' },
  SESSION_COOKIE_NAME: 'session_token',
  SESSION_DURATION_MS: 1000 * 60 * 60 * 24,
}))

const {
  tenantCreate,
  userCreate,
  businessCreate,
  workingHoursCreateMany,
  userFindUnique,
  tenantFindUnique,
  sessionCreate,
  sessionDeleteMany,
} = vi.hoisted(() => ({
  tenantCreate: vi.fn(),
  userCreate: vi.fn(),
  businessCreate: vi.fn(),
  workingHoursCreateMany: vi.fn(),
  userFindUnique: vi.fn(),
  tenantFindUnique: vi.fn(),
  sessionCreate: vi.fn(),
  sessionDeleteMany: vi.fn(),
}))

vi.mock('../src/server/db/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        tenant: { create: tenantCreate },
        user: { create: userCreate },
        business: { create: businessCreate },
        businessWorkingHours: { createMany: workingHoursCreateMany },
      })
    ),
    user: { findUnique: userFindUnique },
    tenant: { findUnique: tenantFindUnique },
    session: { create: sessionCreate, deleteMany: sessionDeleteMany },
  },
}))

vi.mock('../src/server/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi.fn(async (hash: string, pw: string) => hash === `hashed:${pw}`),
}))

import { registerTenant, loginUser, logoutUser } from '../src/server/services/authService'

beforeEach(() => {
  vi.clearAllMocks()
  sessionCreate.mockResolvedValue({})
  workingHoursCreateMany.mockResolvedValue({ count: 7 })
})

describe('registerTenant', () => {
  it('creates tenant, user and business, creates a session, and never returns the password hash', async () => {
    tenantCreate.mockResolvedValue({ id: 't1', name: 'Shop', status: 'trial', createdAt: new Date(), updatedAt: new Date() })
    userCreate.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:secret123',
      name: 'A',
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    businessCreate.mockResolvedValue({ id: 'b1', tenantId: 't1', name: 'Shop' })

    const result = await registerTenant({ businessName: 'Shop', name: 'A', email: 'a@b.com', password: 'secret123' })

    expect(result.user).not.toHaveProperty('passwordHash')
    expect(result.tenant.id).toBe('t1')
    expect(result.business.id).toBe('b1')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
    expect(typeof result.token).toBe('string')
    expect(result.token.length).toBeGreaterThan(0)
  })

  it('creates exactly 7 default working-hours records, one per day, inside the same transaction', async () => {
    tenantCreate.mockResolvedValue({ id: 't1', name: 'Shop', status: 'trial', createdAt: new Date(), updatedAt: new Date() })
    userCreate.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:secret123',
      name: 'A',
      role: 'owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    businessCreate.mockResolvedValue({ id: 'b1', tenantId: 't1', name: 'Shop' })

    await registerTenant({ businessName: 'Shop', name: 'A', email: 'a@b.com', password: 'secret123' })

    expect(workingHoursCreateMany).toHaveBeenCalledTimes(1)
    const call = workingHoursCreateMany.mock.calls[0]![0] as { data: Array<{ businessId: string; dayOfWeek: string }> }
    expect(call.data).toHaveLength(7)
    expect(call.data.every((d) => d.businessId === 'b1')).toBe(true)
    const days = new Set(call.data.map((d) => d.dayOfWeek))
    expect(days.size).toBe(7)
  })
})

describe('loginUser', () => {
  it('rejects an unknown email with a generic error', async () => {
    userFindUnique.mockResolvedValue(null)
    await expect(loginUser({ email: 'nobody@example.com', password: 'whatever' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('rejects a wrong password with the exact same generic error as an unknown email', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:correct',
      name: 'A',
      role: 'owner',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    let unknownEmailError: unknown
    let wrongPasswordError: unknown
    try {
      userFindUnique.mockResolvedValueOnce(null)
      await loginUser({ email: 'nobody@example.com', password: 'x' })
    } catch (err) {
      unknownEmailError = err
    }
    try {
      await loginUser({ email: 'a@b.com', password: 'wrong' })
    } catch (err) {
      wrongPasswordError = err
    }

    expect((unknownEmailError as { code: string }).code).toBe((wrongPasswordError as { code: string }).code)
    expect((unknownEmailError as { message: string }).message).toBe((wrongPasswordError as { message: string }).message)
  })

  it('rejects login for a suspended tenant', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:correct',
      name: 'A',
      role: 'owner',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    tenantFindUnique.mockResolvedValue({ id: 't1', name: 'Shop', status: 'suspended', createdAt: new Date(), updatedAt: new Date() })

    await expect(loginUser({ email: 'a@b.com', password: 'correct' })).rejects.toMatchObject({
      code: 'TENANT_INACTIVE',
    })
  })

  // Team Management (Prompt 15): a deactivated user cannot start a new session — checked after password verification, before the tenant check, so the caller learns nothing without first proving they know the password.
  it('rejects login for a deactivated user (spec §26 step 8), never revealing the account is deactivated to an unauthenticated caller', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:correct',
      name: 'A',
      role: 'owner',
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(loginUser({ email: 'a@b.com', password: 'correct' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'USER_INACTIVE',
    })
    expect(sessionCreate).not.toHaveBeenCalled()
  })

  it('succeeds with correct credentials and an active tenant, without leaking the password hash', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      passwordHash: 'hashed:correct',
      name: 'A',
      role: 'owner',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    tenantFindUnique.mockResolvedValue({ id: 't1', name: 'Shop', status: 'active', createdAt: new Date(), updatedAt: new Date() })

    const result = await loginUser({ email: 'a@b.com', password: 'correct' })
    expect(result.user.email).toBe('a@b.com')
    expect(result.user).not.toHaveProperty('passwordHash')
    expect(sessionCreate).toHaveBeenCalledTimes(1)
  })
})

describe('logoutUser', () => {
  it('does nothing and does not throw when there is no token', async () => {
    await expect(logoutUser(undefined)).resolves.toBeUndefined()
    expect(sessionDeleteMany).not.toHaveBeenCalled()
  })

  it('deletes the session matching the token hash', async () => {
    sessionDeleteMany.mockResolvedValue({ count: 1 })
    await logoutUser('some-raw-token')
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('does not throw even if no matching session is found', async () => {
    sessionDeleteMany.mockResolvedValue({ count: 0 })
    await expect(logoutUser('nonexistent-token')).resolves.toBeUndefined()
  })
})
