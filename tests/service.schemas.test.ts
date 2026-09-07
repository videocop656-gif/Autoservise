import { describe, it, expect } from 'vitest'
import { createServiceSchema, updateServiceSchema, serviceIdParamSchema } from '../src/server/validation/service.schemas'

describe('createServiceSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createServiceSchema.parse({ name: 'Oil change', durationMinutes: 30 })
    expect(result.name).toBe('Oil change')
    expect(result.durationMinutes).toBe(30)
  })

  it('accepts a full valid payload', () => {
    const result = createServiceSchema.parse({
      name: 'Diagnostics',
      description: 'Full computer diagnostics',
      priceFrom: 1000,
      priceTo: 2000,
      currency: 'RUB',
      durationMinutes: 60,
    })
    expect(result.priceFrom).toBe(1000)
    expect(result.priceTo).toBe(2000)
  })

  it('rejects a name that is too short', () => {
    expect(() => createServiceSchema.parse({ name: 'A', durationMinutes: 30 })).toThrow()
  })

  it('rejects a negative priceFrom', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', priceFrom: -100, durationMinutes: 30 })).toThrow()
  })

  it('rejects priceTo less than priceFrom', () => {
    expect(() =>
      createServiceSchema.parse({ name: 'Oil change', priceFrom: 2000, priceTo: 1000, durationMinutes: 30 })
    ).toThrow()
  })

  it('accepts priceTo equal to priceFrom', () => {
    expect(() =>
      createServiceSchema.parse({ name: 'Oil change', priceFrom: 1000, priceTo: 1000, durationMinutes: 30 })
    ).not.toThrow()
  })

  it('rejects durationMinutes of 0', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', durationMinutes: 0 })).toThrow()
  })

  it('rejects a negative durationMinutes', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', durationMinutes: -5 })).toThrow()
  })

  it('rejects a fractional durationMinutes', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', durationMinutes: 5.5 })).toThrow()
  })

  it('rejects durationMinutes over 1440', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', durationMinutes: 1441 })).toThrow()
  })

  it('rejects an unsupported currency', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change', durationMinutes: 30, currency: 'GBP' })).toThrow()
  })

  it('rejects a missing required field (durationMinutes)', () => {
    expect(() => createServiceSchema.parse({ name: 'Oil change' })).toThrow()
  })
})

describe('updateServiceSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateServiceSchema.parse({ isActive: false })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateServiceSchema.parse({})).toThrow()
  })

  it('rejects priceTo less than priceFrom when both are provided', () => {
    expect(() => updateServiceSchema.parse({ priceFrom: 500, priceTo: 100 })).toThrow()
  })
})

describe('serviceIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => serviceIdParamSchema.parse('123e4567-e89b-12d3-a456-426614174000')).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => serviceIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
