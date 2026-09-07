import { describe, it, expect } from 'vitest'
import { requireRole } from '../src/server/middleware/requireRole'
import type { AuthContext } from '../src/server/types/auth'

function ctxWithRole(role: 'owner' | 'admin' | 'manager'): AuthContext {
  return {
    user: {
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      name: 'A',
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tenant: { id: 't1', name: 'T', status: 'trial', createdAt: new Date(), updatedAt: new Date() },
    sessionId: 's1',
  }
}

describe('requireRole', () => {
  it('allows a matching role', () => {
    expect(() => requireRole(ctxWithRole('owner'), 'owner')).not.toThrow()
  })

  it('rejects a manager attempting an owner-only action', () => {
    expect(() => requireRole(ctxWithRole('manager'), 'owner')).toThrow()
  })

  it('allows any of several accepted roles', () => {
    expect(() => requireRole(ctxWithRole('admin'), 'owner', 'admin')).not.toThrow()
  })

  it('rejects when no roles are allowed to perform the action', () => {
    expect(() => requireRole(ctxWithRole('owner'))).toThrow()
  })
})
