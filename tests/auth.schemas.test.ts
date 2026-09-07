import { describe, it, expect } from 'vitest'
import { registerSchema, loginSchema } from '../src/server/validation/auth.schemas'

describe('registerSchema', () => {
  it('accepts valid input and normalizes email', () => {
    const result = registerSchema.parse({
      businessName: 'Best Auto Service',
      name: 'Ivan Ivanov',
      email: '  Ivan@Example.COM ',
      password: 'strongpassword123',
    })
    expect(result.email).toBe('ivan@example.com')
  })

  it('rejects a too-short password', () => {
    expect(() =>
      registerSchema.parse({
        businessName: 'Best Auto Service',
        name: 'Ivan Ivanov',
        email: 'ivan@example.com',
        password: '123',
      })
    ).toThrow()
  })

  it('rejects an invalid email', () => {
    expect(() =>
      registerSchema.parse({
        businessName: 'Best Auto Service',
        name: 'Ivan Ivanov',
        email: 'not-an-email',
        password: 'strongpassword123',
      })
    ).toThrow()
  })

  it('rejects a missing business name', () => {
    expect(() =>
      registerSchema.parse({
        businessName: '',
        name: 'Ivan Ivanov',
        email: 'ivan@example.com',
        password: 'strongpassword123',
      })
    ).toThrow()
  })
})

describe('loginSchema', () => {
  it('normalizes email and accepts any non-empty password', () => {
    const result = loginSchema.parse({ email: 'User@Example.com', password: 'x' })
    expect(result.email).toBe('user@example.com')
  })

  it('rejects an empty password', () => {
    expect(() => loginSchema.parse({ email: 'user@example.com', password: '' })).toThrow()
  })
})
