import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { makeAuthContext } from './helpers/fixtures'

const { LastOwnerViolationErrorMock, ...mocks } = vi.hoisted(() => ({
  list: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  updateProfile: vi.fn(),
  changeRole: vi.fn(),
  deactivate: vi.fn(),
  activate: vi.fn(),
  LastOwnerViolationErrorMock: class LastOwnerViolationErrorMock extends Error {},
}))

vi.mock('../src/server/repositories/teamRepository', () => ({
  teamRepository: mocks,
  LastOwnerViolationError: LastOwnerViolationErrorMock,
  isSerializationConflict: (err: unknown) => err instanceof Error && err.message === 'SERIALIZATION_CONFLICT',
}))

vi.mock('../src/server/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
}))

import {
  listTeam,
  getTeamMember,
  createTeamMember,
  updateTeamMemberProfile,
  changeTeamMemberRole,
  activateTeamMember,
  deactivateTeamMember,
} from '../src/server/services/teamService'

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    tenantId: 't1',
    email: 'target@example.com',
    passwordHash: 'hashed:x',
    name: 'Target',
    role: 'manager',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listTeam / getTeamMember — everyone can read', () => {
  it('owner, admin, and manager can all list', async () => {
    mocks.list.mockResolvedValue([])
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(listTeam(makeAuthContext(role))).resolves.toEqual([])
    }
  })

  it('list is scoped to the requesting tenant only', async () => {
    mocks.list.mockResolvedValue([])
    const ctx = makeAuthContext('owner')
    await listTeam(ctx)
    expect(mocks.list).toHaveBeenCalledWith(ctx.tenant.id)
  })

  it('getTeamMember 404s for a foreign/unknown id', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(getTeamMember(makeAuthContext('manager'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('createTeamMember — permission matrix (spec §2/§7)', () => {
  it('manager cannot create anyone', async () => {
    await expect(createTeamMember(makeAuthContext('manager'), { name: 'X', email: 'x@x.com', password: 'password1', role: 'manager' })).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('admin can create admin and manager', async () => {
    mocks.create.mockResolvedValue(makeUser())
    for (const role of ['admin', 'manager'] as const) {
      await expect(
        createTeamMember(makeAuthContext('admin'), { name: 'X', email: 'x@x.com', password: 'password1', role })
      ).resolves.toBeDefined()
    }
  })

  it('admin CANNOT create an owner (spec: "Can an admin create an owner? NO")', async () => {
    await expect(
      createTeamMember(makeAuthContext('admin'), { name: 'X', email: 'x@x.com', password: 'password1', role: 'owner' })
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('owner can create owner, admin, and manager — multiple owners are explicitly allowed', async () => {
    mocks.create.mockResolvedValue(makeUser({ role: 'owner' }))
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(
        createTeamMember(makeAuthContext('owner'), { name: 'X', email: 'x@x.com', password: 'password1', role })
      ).resolves.toBeDefined()
    }
  })

  it('hashes the password with Argon2id and never stores/returns plaintext', async () => {
    mocks.create.mockResolvedValue(makeUser())
    await createTeamMember(makeAuthContext('owner'), { name: 'X', email: 'x@x.com', password: 'plaintext-pw', role: 'manager' })
    const call = mocks.create.mock.calls[0]![0] as { passwordHash: string }
    expect(call.passwordHash).toBe('hashed:plaintext-pw')
    expect(call).not.toHaveProperty('password')
  })

  it('scopes the new user to the creator\'s own tenant, never a client-supplied one', async () => {
    mocks.create.mockResolvedValue(makeUser())
    const ctx = makeAuthContext('owner')
    await createTeamMember(ctx, { name: 'X', email: 'x@x.com', password: 'password1', role: 'manager' })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ctx.tenant.id }))
  })

  it('duplicate email maps a real P2002 into a safe 409, never a raw DB error', async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }))
    await expect(
      createTeamMember(makeAuthContext('owner'), { name: 'X', email: 'dup@x.com', password: 'password1', role: 'manager' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'USER_EMAIL_ALREADY_EXISTS' })
  })
})

describe('updateTeamMemberProfile — permission matrix for multiple owners (spec §12/§28)', () => {
  it('Owner A -> PATCH Owner B profile: allowed', async () => {
    mocks.findById.mockResolvedValue(makeUser({ id: 'owner-b', role: 'owner' }))
    mocks.updateProfile.mockResolvedValue(makeUser({ id: 'owner-b', role: 'owner', name: 'New' }))
    const ownerA = makeAuthContext('owner', { user: { ...makeAuthContext('owner').user, id: 'owner-a' } })
    await expect(updateTeamMemberProfile(ownerA, 'owner-b', { name: 'New' })).resolves.toBeDefined()
  })

  it('Owner B -> PATCH Owner A profile: allowed (symmetric — multiple owners can edit each other)', async () => {
    mocks.findById.mockResolvedValue(makeUser({ id: 'owner-a', role: 'owner' }))
    mocks.updateProfile.mockResolvedValue(makeUser({ id: 'owner-a', role: 'owner' }))
    const ownerB = makeAuthContext('owner', { user: { ...makeAuthContext('owner').user, id: 'owner-b' } })
    await expect(updateTeamMemberProfile(ownerB, 'owner-a', { name: 'New' })).resolves.toBeDefined()
  })

  it('Admin A -> PATCH Owner A/B profile: 403 in both cases', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    await expect(updateTeamMemberProfile(makeAuthContext('admin'), 'owner-a', { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateTeamMemberProfile(makeAuthContext('admin'), 'owner-b', { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('Owner A -> PATCH Admin A / Manager A profile: allowed', async () => {
    mocks.findById.mockResolvedValueOnce(makeUser({ role: 'admin' })).mockResolvedValueOnce(makeUser({ role: 'manager' }))
    mocks.updateProfile.mockResolvedValue(makeUser())
    await expect(updateTeamMemberProfile(makeAuthContext('owner'), 'admin-a', { name: 'X' })).resolves.toBeDefined()
    await expect(updateTeamMemberProfile(makeAuthContext('owner'), 'manager-a', { name: 'X' })).resolves.toBeDefined()
  })

  it('Admin A -> PATCH Manager A profile: allowed', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    mocks.updateProfile.mockResolvedValue(makeUser({ role: 'manager' }))
    await expect(updateTeamMemberProfile(makeAuthContext('admin'), 'manager-a', { name: 'X' })).resolves.toBeDefined()
  })

  it('Admin A -> PATCH own (Admin A) profile: allowed', async () => {
    const admin = makeAuthContext('admin')
    mocks.findById.mockResolvedValue(makeUser({ id: admin.user.id, role: 'admin' }))
    mocks.updateProfile.mockResolvedValue(makeUser({ id: admin.user.id, role: 'admin' }))
    await expect(updateTeamMemberProfile(admin, admin.user.id, { name: 'X' })).resolves.toBeDefined()
  })

  it('Manager A -> PATCH anyone: 403, including their own profile (spec: manager cannot touch profile fields at all)', async () => {
    const manager = makeAuthContext('manager')
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    await expect(updateTeamMemberProfile(manager, 'someone', { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateTeamMemberProfile(manager, manager.user.id, { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('PATCH Owner B profile never touches role/isActive/tenantId/businessId, and never triggers the last-owner check', async () => {
    mocks.findById.mockResolvedValue(makeUser({ id: 'owner-b', role: 'owner' }))
    mocks.updateProfile.mockResolvedValue(makeUser({ id: 'owner-b', role: 'owner' }))
    await updateTeamMemberProfile(makeAuthContext('owner'), 'owner-b', { name: 'New Name' })
    const call = mocks.updateProfile.mock.calls[0]![2] as Record<string, unknown>
    expect(call).toEqual({ name: 'New Name' })
    expect(Object.keys(call)).not.toContain('role')
    expect(Object.keys(call)).not.toContain('isActive')
    expect(Object.keys(call)).not.toContain('tenantId')
    expect(Object.keys(call)).not.toContain('businessId')
  })

  it('duplicate email on profile update maps P2002 to a safe 409', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    mocks.updateProfile.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }))
    await expect(updateTeamMemberProfile(makeAuthContext('owner'), 'x', { email: 'dup@x.com' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'USER_EMAIL_ALREADY_EXISTS',
    })
  })
})

describe('changeTeamMemberRole — transition matrix (spec §10)', () => {
  it('manager cannot change any role', async () => {
    await expect(changeTeamMemberRole(makeAuthContext('manager'), 'x', { role: 'admin' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin: manager -> admin and admin -> manager are allowed', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    mocks.changeRole.mockResolvedValue(makeUser({ role: 'admin' }))
    await expect(changeTeamMemberRole(makeAuthContext('admin'), 'x', { role: 'admin' })).resolves.toBeDefined()

    mocks.findById.mockResolvedValue(makeUser({ role: 'admin' }))
    mocks.changeRole.mockResolvedValue(makeUser({ role: 'manager' }))
    await expect(changeTeamMemberRole(makeAuthContext('admin'), 'x', { role: 'manager' })).resolves.toBeDefined()
  })

  it('admin -> owner is 403 ("Can an admin manage an owner? NO")', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    await expect(changeTeamMemberRole(makeAuthContext('admin'), 'x', { role: 'owner' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.changeRole).not.toHaveBeenCalled()
  })

  it('admin cannot change an owner\'s role to anything, even admin/manager', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    await expect(changeTeamMemberRole(makeAuthContext('admin'), 'x', { role: 'manager' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.changeRole).not.toHaveBeenCalled()
  })

  it('owner: manager -> owner and admin -> owner are allowed (only owner can promote to owner)', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    mocks.changeRole.mockResolvedValue(makeUser({ role: 'owner' }))
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'x', { role: 'owner' })).resolves.toBeDefined()

    mocks.findById.mockResolvedValue(makeUser({ role: 'admin' }))
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'x', { role: 'owner' })).resolves.toBeDefined()
  })

  it('owner: owner -> admin and owner -> manager are allowed when another active owner exists', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    mocks.changeRole.mockResolvedValue(makeUser({ role: 'admin' }))
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'x', { role: 'admin' })).resolves.toBeDefined()
    expect(mocks.changeRole).toHaveBeenCalledWith(expect.any(String), 'x', 'admin', { requireOtherActiveOwner: true })
  })

  it('demoting the LAST active owner is rejected 409 LAST_OWNER_REQUIRED', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    mocks.changeRole.mockRejectedValue(new LastOwnerViolationErrorMock())
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'x', { role: 'admin' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'LAST_OWNER_REQUIRED',
    })
  })

  it('a genuine concurrent-write conflict (serialization failure) surfaces as a safe 409, never a raw transaction error', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    mocks.changeRole.mockRejectedValue(new Error('SERIALIZATION_CONFLICT'))
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'x', { role: 'admin' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('self role change is always rejected 409, for every role', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const ctx = makeAuthContext(role)
      mocks.findById.mockResolvedValue(makeUser({ id: ctx.user.id, role }))
      await expect(changeTeamMemberRole(ctx, ctx.user.id, { role: 'manager' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'CANNOT_CHANGE_OWN_ROLE',
      })
    }
    expect(mocks.changeRole).not.toHaveBeenCalled()
  })

  it('same-role request is an idempotent no-op and never touches the last-owner rule', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner', id: 'owner-b' }))
    const result = await changeTeamMemberRole(makeAuthContext('owner'), 'owner-b', { role: 'owner' })
    expect(result).toMatchObject({ role: 'owner' })
    expect(mocks.changeRole).not.toHaveBeenCalled()
  })

  it('foreign/unknown target 404s before any permission logic runs', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(changeTeamMemberRole(makeAuthContext('owner'), 'missing', { role: 'admin' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('activateTeamMember (spec §11)', () => {
  it('owner can activate anyone, including an owner', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner', isActive: false }))
    mocks.activate.mockResolvedValue(makeUser({ role: 'owner', isActive: true }))
    await expect(activateTeamMember(makeAuthContext('owner'), 'x')).resolves.toMatchObject({ isActive: true })
  })

  it('admin can activate admin/manager but not owner', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager', isActive: false }))
    mocks.activate.mockResolvedValue(makeUser({ role: 'manager', isActive: true }))
    await expect(activateTeamMember(makeAuthContext('admin'), 'x')).resolves.toBeDefined()

    mocks.findById.mockResolvedValue(makeUser({ role: 'owner', isActive: false }))
    await expect(activateTeamMember(makeAuthContext('admin'), 'x')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('manager cannot activate anyone', async () => {
    await expect(activateTeamMember(makeAuthContext('manager'), 'x')).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('deactivateTeamMember (spec §11)', () => {
  it('self-deactivation is always rejected 409, for every role', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const ctx = makeAuthContext(role)
      mocks.findById.mockResolvedValue(makeUser({ id: ctx.user.id, role }))
      await expect(deactivateTeamMember(ctx, ctx.user.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'CANNOT_DEACTIVATE_SELF',
      })
    }
    expect(mocks.deactivate).not.toHaveBeenCalled()
  })

  it('manager cannot deactivate anyone', async () => {
    await expect(deactivateTeamMember(makeAuthContext('manager'), 'x')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('admin cannot deactivate an owner', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    await expect(deactivateTeamMember(makeAuthContext('admin'), 'x')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.deactivate).not.toHaveBeenCalled()
  })

  it('owner can deactivate another owner when a second active owner remains', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    mocks.deactivate.mockResolvedValue(makeUser({ role: 'owner', isActive: false }))
    await expect(deactivateTeamMember(makeAuthContext('owner'), 'x')).resolves.toMatchObject({ isActive: false })
    expect(mocks.deactivate).toHaveBeenCalledWith(expect.any(String), 'x', { requireOtherActiveOwner: true })
  })

  it('deactivating the LAST active owner is rejected 409 LAST_OWNER_REQUIRED', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner' }))
    mocks.deactivate.mockRejectedValue(new LastOwnerViolationErrorMock())
    await expect(deactivateTeamMember(makeAuthContext('owner'), 'x')).rejects.toMatchObject({
      statusCode: 409,
      code: 'LAST_OWNER_REQUIRED',
    })
  })

  it('deactivating a non-owner never requires the last-owner check', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'manager' }))
    mocks.deactivate.mockResolvedValue(makeUser({ role: 'manager', isActive: false }))
    await deactivateTeamMember(makeAuthContext('owner'), 'x')
    expect(mocks.deactivate).toHaveBeenCalledWith(expect.any(String), 'x', { requireOtherActiveOwner: false })
  })

  it('deactivating an already-inactive user is an idempotent no-op, never re-triggering the last-owner check', async () => {
    mocks.findById.mockResolvedValue(makeUser({ role: 'owner', isActive: false }))
    const result = await deactivateTeamMember(makeAuthContext('owner'), 'x')
    expect(result).toMatchObject({ isActive: false })
    expect(mocks.deactivate).not.toHaveBeenCalled()
  })

  it('foreign/unknown target 404s', async () => {
    mocks.findById.mockResolvedValue(null)
    await expect(deactivateTeamMember(makeAuthContext('owner'), 'missing')).rejects.toMatchObject({ statusCode: 404 })
  })
})
