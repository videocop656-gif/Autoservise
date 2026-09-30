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

// Prompt 50 — Количество постов (Business.serviceBayCapacity).
describe('businessProfileSchema — serviceBayCapacity', () => {
  const capacityError = (value: unknown) => {
    const result = businessProfileSchema.safeParse({ serviceBayCapacity: value })
    return result.success ? null : result.error.flatten().fieldErrors.serviceBayCapacity?.[0]
  }

  it('accepts whole numbers from 1 up to the sanity limit', () => {
    expect(businessProfileSchema.parse({ serviceBayCapacity: 1 }).serviceBayCapacity).toBe(1)
    expect(businessProfileSchema.parse({ serviceBayCapacity: 3 }).serviceBayCapacity).toBe(3)
    expect(businessProfileSchema.parse({ serviceBayCapacity: 1000 }).serviceBayCapacity).toBe(1000)
  })

  it('is optional — a profile edit without it leaves capacity untouched', () => {
    expect('serviceBayCapacity' in businessProfileSchema.parse({ name: 'Автосервис' })).toBe(false)
  })

  it('rejects 0 in Russian', () => {
    expect(capacityError(0)).toBe('Количество постов должно быть не менее 1.')
  })

  it('rejects a negative number', () => {
    expect(capacityError(-2)).toBe('Количество постов должно быть не менее 1.')
  })

  it('rejects a fraction', () => {
    expect(capacityError(1.5)).toBe('Количество постов должно быть целым числом.')
  })

  it.each([
    ['NaN (arrives as null over JSON)', null],
    ['a numeric string', '2'],
    ['an empty string', ''],
    ['text', 'много'],
    ['NaN itself', Number.NaN],
  ])('rejects %s', (_label, value) => {
    expect(capacityError(value)).toBe('Количество постов должно быть не менее 1.')
  })

  it('rejects an absurd value above the sanity limit', () => {
    expect(capacityError(1001)).toBe('Количество постов не может быть больше 1000.')
  })
})
