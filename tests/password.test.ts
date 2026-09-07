import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/server/auth/password'

describe('password hashing', () => {
  it('hashes a password into an argon2id string', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toContain('$argon2id$')
  })

  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false)
  })

  it('produces different hashes for the same password (unique salts)', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')])
    expect(a).not.toBe(b)
  })

  it('never throws on a malformed stored hash, just returns false', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false)
  })
})
