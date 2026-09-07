import { describe, it, expect } from 'vitest'
import { createCustomerSchema, updateCustomerSchema, customerIdParamSchema } from '../src/server/validation/customer.schemas'

describe('createCustomerSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createCustomerSchema.parse({ firstName: 'Ivan', phone: '+7 999 1234567' })
    expect(result.firstName).toBe('Ivan')
    expect(result.lastName).toBeUndefined()
  })

  it('normalizes email to lowercase and trims it', () => {
    const result = createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345', email: '  Ivan@Example.COM  ' })
    expect(result.email).toBe('ivan@example.com')
  })

  it('treats an empty optional string as null', () => {
    const result = createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345', lastName: '' })
    expect(result.lastName).toBeNull()
  })

  it('treats a whitespace-only optional string as null', () => {
    const result = createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345', email: '   ' })
    expect(result.email).toBeNull()
  })

  it('omitted optional fields are absent from the parsed result', () => {
    const result = createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345' })
    expect(result.lastName).toBeUndefined()
    expect(result.email).toBeUndefined()
    expect(result.notes).toBeUndefined()
  })

  it('rejects a missing first name', () => {
    expect(() => createCustomerSchema.parse({ phone: '12345' })).toThrow()
  })

  it('rejects an empty first name', () => {
    expect(() => createCustomerSchema.parse({ firstName: '', phone: '12345' })).toThrow()
  })

  it('rejects a phone that is too short', () => {
    expect(() => createCustomerSchema.parse({ firstName: 'Ivan', phone: '123' })).toThrow()
  })

  it('rejects a missing phone', () => {
    expect(() => createCustomerSchema.parse({ firstName: 'Ivan' })).toThrow()
  })

  it('rejects an invalid email', () => {
    expect(() => createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345', email: 'not-an-email' })).toThrow()
  })

  it('rejects notes over the max length', () => {
    expect(() => createCustomerSchema.parse({ firstName: 'Ivan', phone: '12345', notes: 'a'.repeat(5001) })).toThrow()
  })
})

describe('updateCustomerSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateCustomerSchema.parse({ isActive: false })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateCustomerSchema.parse({})).toThrow()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateCustomerSchema.parse({ isActive: false }) as Record<string, unknown>
    expect('firstName' in result).toBe(false)
    expect('email' in result).toBe(false)
  })

  it('null explicitly clears an optional field', () => {
    const result = updateCustomerSchema.parse({ email: null })
    expect(result.email).toBeNull()
  })

  it('an empty/whitespace string clears an optional field to null, same as explicit null', () => {
    const result = updateCustomerSchema.parse({ lastName: '  ' })
    expect(result.lastName).toBeNull()
  })

  it('rejects clearing the required firstName via null or an empty string', () => {
    expect(() => updateCustomerSchema.parse({ firstName: null })).toThrow()
    expect(() => updateCustomerSchema.parse({ firstName: '' })).toThrow()
  })

  it('rejects clearing the required phone via null', () => {
    expect(() => updateCustomerSchema.parse({ phone: null })).toThrow()
  })
})

describe('customerIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => customerIdParamSchema.parse('123e4567-e89b-12d3-a456-426614174000')).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => customerIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
