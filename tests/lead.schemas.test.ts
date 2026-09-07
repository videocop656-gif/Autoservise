import { describe, it, expect } from 'vitest'
import { createLeadSchema, updateLeadSchema, leadIdParamSchema } from '../src/server/validation/lead.schemas'

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('createLeadSchema', () => {
  it('accepts a minimal valid payload and defaults status/source', () => {
    const result = createLeadSchema.parse({ customerId: VALID_ID, subject: 'Oil change question' })
    expect(result.status).toBeUndefined()
    expect(result.source).toBeUndefined()
  })

  it('accepts an explicit status and source', () => {
    const result = createLeadSchema.parse({
      customerId: VALID_ID,
      subject: 'Oil change question',
      status: 'QUALIFIED',
      source: 'PHONE',
    })
    expect(result.status).toBe('QUALIFIED')
    expect(result.source).toBe('PHONE')
  })

  it('rejects a missing customerId', () => {
    expect(() => createLeadSchema.parse({ subject: 'Oil change question' })).toThrow()
  })

  it('rejects an invalid customerId', () => {
    expect(() => createLeadSchema.parse({ customerId: 'not-a-uuid', subject: 'Oil change question' })).toThrow()
  })

  it('rejects a subject that is too short', () => {
    expect(() => createLeadSchema.parse({ customerId: VALID_ID, subject: 'A' })).toThrow()
  })

  it('rejects a missing subject', () => {
    expect(() => createLeadSchema.parse({ customerId: VALID_ID })).toThrow()
  })

  it('rejects an invalid status', () => {
    expect(() => createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', status: 'NOT_REAL' })).toThrow()
  })

  it('rejects an invalid source', () => {
    expect(() => createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', source: 'TELEGRAM' })).toThrow()
  })

  it('accepts null vehicleId/serviceId', () => {
    expect(() =>
      createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', vehicleId: null, serviceId: null })
    ).not.toThrow()
  })

  it('treats an empty-string vehicleId/serviceId as null (cleared <select>), not a validation error', () => {
    const result = createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', vehicleId: '', serviceId: '' })
    expect(result.vehicleId).toBeNull()
    expect(result.serviceId).toBeNull()
  })

  it('omitted optional fields are absent (service layer stores them as null)', () => {
    const result = createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject' })
    expect(result.vehicleId).toBeUndefined()
    expect(result.serviceId).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.notes).toBeUndefined()
  })

  it('treats blank description/notes as null', () => {
    const result = createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', description: '   ', notes: '' })
    expect(result.description).toBeNull()
    expect(result.notes).toBeNull()
  })

  it('rejects description over the max length', () => {
    expect(() =>
      createLeadSchema.parse({ customerId: VALID_ID, subject: 'Subject', description: 'a'.repeat(10001) })
    ).toThrow()
  })
})

describe('updateLeadSchema', () => {
  it('accepts a partial update (status only)', () => {
    expect(() => updateLeadSchema.parse({ status: 'LOST' })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateLeadSchema.parse({})).toThrow()
  })

  it('allows customerId to be changed', () => {
    const result = updateLeadSchema.parse({ customerId: VALID_ID })
    expect(result.customerId).toBe(VALID_ID)
  })

  it('allows vehicleId to be explicitly cleared to null', () => {
    const result = updateLeadSchema.parse({ vehicleId: null })
    expect(result.vehicleId).toBeNull()
  })

  it('treats an empty-string vehicleId/serviceId in an update as clearing it to null too', () => {
    const result = updateLeadSchema.parse({ vehicleId: '', serviceId: '' })
    expect(result.vehicleId).toBeNull()
    expect(result.serviceId).toBeNull()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateLeadSchema.parse({ status: 'LOST' }) as Record<string, unknown>
    expect('subject' in result).toBe(false)
    expect('vehicleId' in result).toBe(false)
  })

  it('rejects clearing the required customerId via null', () => {
    expect(() => updateLeadSchema.parse({ customerId: null })).toThrow()
  })

  it('rejects clearing the required subject via null or an empty string', () => {
    expect(() => updateLeadSchema.parse({ subject: null })).toThrow()
    expect(() => updateLeadSchema.parse({ subject: '' })).toThrow()
  })
})

describe('leadIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => leadIdParamSchema.parse(VALID_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => leadIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
