import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/server/lib/env', () => ({
  env: { sessionSecret: 'test-secret-value-1234567890' },
  SESSION_COOKIE_NAME: 'session_token',
  SESSION_DURATION_MS: 1000 * 60 * 60,
}))

import { generateSessionToken, hashSessionToken } from '../src/server/auth/tokens'

describe('session tokens', () => {
  it('generates a random token of sufficient length', () => {
    const token = generateSessionToken()
    expect(token.length).toBeGreaterThanOrEqual(32)
  })

  it('generates unique tokens on each call', () => {
    const a = generateSessionToken()
    const b = generateSessionToken()
    expect(a).not.toBe(b)
  })

  it('hashes a token deterministically', () => {
    const token = 'fixed-token-value'
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'))
  })

  it('never stores the raw token as its own hash', () => {
    const token = 'fixed-token-value'
    expect(hashSessionToken(token)).not.toBe(token)
  })
})
