import { describe, it, expect } from 'vitest'
import { businessProfileSchema } from '../src/server/validation/business.schemas'

describe('businessProfileSchema', () => {
  it('accepts a valid partial update', () => {
    const result = businessProfileSchema.parse({ name: 'Best Auto Service', currency: 'USD' })
    expect(result.name).toBe('Best Auto Service')
    expect(result.currency).toBe('USD')
  })

  it('rejects an empty body', () => {
    expect(() => businessProfileSchema.parse({})).toThrow()
  })

  it('rejects an invalid email', () => {
    expect(() => businessProfileSchema.parse({ email: 'not-an-email' })).toThrow()
  })

  it('rejects an invalid website URL', () => {
    expect(() => businessProfileSchema.parse({ website: 'not a url' })).toThrow()
  })

  it('accepts a valid website URL', () => {
    const result = businessProfileSchema.parse({ website: 'https://example.com' })
    expect(result.website).toBe('https://example.com')
  })

  it('rejects an invalid IANA timezone', () => {
    expect(() => businessProfileSchema.parse({ timezone: 'GMT+5' })).toThrow()
  })

  it('accepts a valid IANA timezone', () => {
    const result = businessProfileSchema.parse({ timezone: 'Europe/Moscow' })
    expect(result.timezone).toBe('Europe/Moscow')
  })

  it('rejects an unsupported currency', () => {
    expect(() => businessProfileSchema.parse({ currency: 'GBP' })).toThrow()
  })

  it('treats an empty string as clearing an optional field', () => {
    const result = businessProfileSchema.parse({ phone: '' })
    expect(result.phone).toBeNull()
  })

  it('rejects a name that is too short', () => {
    expect(() => businessProfileSchema.parse({ name: 'A' })).toThrow()
  })
})
