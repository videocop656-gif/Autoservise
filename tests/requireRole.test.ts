import { describe, it, expect } from 'vitest'
import { requireRole } from '../src/server/middleware/requireRole'
import { makeAuthContext } from './helpers/fixtures'

describe('requireRole', () => {
  it('allows a matching role', () => {
    expect(() => requireRole(makeAuthContext('owner'), 'owner')).not.toThrow()
  })

  it('rejects a manager attempting an owner-only action', () => {
    expect(() => requireRole(makeAuthContext('manager'), 'owner')).toThrow()
  })

  it('allows any of several accepted roles', () => {
    expect(() => requireRole(makeAuthContext('admin'), 'owner', 'admin')).not.toThrow()
  })

  it('rejects when no roles are allowed to perform the action', () => {
    expect(() => requireRole(makeAuthContext('owner'))).toThrow()
  })
})
