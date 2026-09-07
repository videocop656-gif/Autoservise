import { describe, it, expect } from 'vitest'
import {
  createCustomerRequestSchema,
  updateCustomerRequestSchema,
  customerRequestIdParamSchema,
} from '../src/server/validation/customerRequest.schemas'

const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174000'
const VEHICLE_ID = '223e4567-e89b-12d3-a456-426614174000'
const SERVICE_ID = '323e4567-e89b-12d3-a456-426614174000'
const APPOINTMENT_ID = '423e4567-e89b-12d3-a456-426614174000'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    subject: 'Стук спереди на BMW X5',
    ...overrides,
  }
}

describe('createCustomerRequestSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createCustomerRequestSchema.parse(basePayload())
    expect(result.customerId).toBe(CUSTOMER_ID)
    expect(result.subject).toBe('Стук спереди на BMW X5')
  })

  it('accepts optional vehicleId/serviceId/appointmentId', () => {
    const result = createCustomerRequestSchema.parse(
      basePayload({ vehicleId: VEHICLE_ID, serviceId: SERVICE_ID, appointmentId: APPOINTMENT_ID })
    )
    expect(result.vehicleId).toBe(VEHICLE_ID)
    expect(result.serviceId).toBe(SERVICE_ID)
    expect(result.appointmentId).toBe(APPOINTMENT_ID)
  })

  it('treats empty-string vehicleId/serviceId/appointmentId as null', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ vehicleId: '', serviceId: '', appointmentId: '' }))
    expect(result.vehicleId).toBeNull()
    expect(result.serviceId).toBeNull()
    expect(result.appointmentId).toBeNull()
  })

  it('does not accept a status field on create (always starts at NEW)', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ status: 'QUALIFIED' })) as Record<string, unknown>
    expect('status' in result).toBe(false)
  })

  it('defaults source to undefined (service layer defaults to MANUAL)', () => {
    const result = createCustomerRequestSchema.parse(basePayload())
    expect(result.source).toBeUndefined()
  })

  it('accepts an explicit source', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ source: 'PHONE' }))
    expect(result.source).toBe('PHONE')
  })

  it('rejects an invalid source', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ source: 'TELEGRAM' }))).toThrow()
  })

  it('rejects a missing customerId', () => {
    const { customerId: _c, ...withoutCustomer } = basePayload()
    expect(() => createCustomerRequestSchema.parse(withoutCustomer)).toThrow()
  })

  it('rejects a missing subject', () => {
    const { subject: _s, ...withoutSubject } = basePayload()
    expect(() => createCustomerRequestSchema.parse(withoutSubject)).toThrow()
  })

  it('rejects a subject that is too short', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ subject: 'A' }))).toThrow()
  })

  it('rejects a subject over the max length', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ subject: 'a'.repeat(201) }))).toThrow()
  })

  it('rejects a description over the max length', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ description: 'a'.repeat(10001) }))).toThrow()
  })

  it('rejects notes over the max length', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ notes: 'a'.repeat(5001) }))).toThrow()
  })

  it('treats blank optional text fields as null', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ description: '  ', notes: '' }))
    expect(result.description).toBeNull()
    expect(result.notes).toBeNull()
  })

  it('accepts a valid ISO 8601 requestedDate', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ requestedDate: '2026-09-10T00:00:00Z' }))
    expect(result.requestedDate).toBe('2026-09-10T00:00:00Z')
  })

  it('treats a blank requestedDate as null', () => {
    const result = createCustomerRequestSchema.parse(basePayload({ requestedDate: '' }))
    expect(result.requestedDate).toBeNull()
  })

  it('rejects an invalid requestedDate', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedDate: 'tomorrow' }))).toThrow()
  })

  it('rejects a requestedDate without a timezone offset', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedDate: '2026-09-10T00:00:00' }))).toThrow()
  })

  it('accepts valid requestedTimeFrom/requestedTimeTo, including 00:00 and 23:59', () => {
    expect(() =>
      createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '00:00', requestedTimeTo: '23:59' }))
    ).not.toThrow()
  })

  it('accepts only one of requestedTimeFrom/requestedTimeTo', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '15:00' }))).not.toThrow()
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeTo: '18:00' }))).not.toThrow()
  })

  it('rejects an invalid requestedTimeFrom format', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '9:00' }))).toThrow()
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '24:00' }))).toThrow()
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '12:60' }))).toThrow()
  })

  it('rejects an invalid requestedTimeTo format', () => {
    expect(() => createCustomerRequestSchema.parse(basePayload({ requestedTimeTo: 'noon' }))).toThrow()
  })

  it('rejects requestedTimeFrom >= requestedTimeTo', () => {
    expect(() =>
      createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '15:00', requestedTimeTo: '15:00' }))
    ).toThrow()
    expect(() =>
      createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '18:00', requestedTimeTo: '15:00' }))
    ).toThrow()
  })

  it('accepts requestedTimeFrom < requestedTimeTo', () => {
    expect(() =>
      createCustomerRequestSchema.parse(basePayload({ requestedTimeFrom: '09:00', requestedTimeTo: '15:30' }))
    ).not.toThrow()
  })
})

describe('updateCustomerRequestSchema', () => {
  it('accepts a status-only update', () => {
    expect(() => updateCustomerRequestSchema.parse({ status: 'IN_PROGRESS' })).not.toThrow()
  })

  it('rejects an invalid status', () => {
    expect(() => updateCustomerRequestSchema.parse({ status: 'DONE' })).toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateCustomerRequestSchema.parse({})).toThrow()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateCustomerRequestSchema.parse({ status: 'IN_PROGRESS' }) as Record<string, unknown>
    expect('subject' in result).toBe(false)
    expect('requestedTimeFrom' in result).toBe(false)
  })

  it('allows clearing appointmentId to null', () => {
    const result = updateCustomerRequestSchema.parse({ appointmentId: null })
    expect(result.appointmentId).toBeNull()
  })

  it('rejects clearing the required subject via an empty string', () => {
    expect(() => updateCustomerRequestSchema.parse({ subject: '' })).toThrow()
  })

  it('does not cross-check time range when only one side is part of the PATCH (service layer merges with the existing value)', () => {
    expect(() => updateCustomerRequestSchema.parse({ requestedTimeFrom: '18:00' })).not.toThrow()
  })

  it('rejects requestedTimeFrom >= requestedTimeTo when both are part of the PATCH', () => {
    expect(() => updateCustomerRequestSchema.parse({ requestedTimeFrom: '18:00', requestedTimeTo: '15:00' })).toThrow()
  })
})

describe('customerRequestIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => customerRequestIdParamSchema.parse(CUSTOMER_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => customerRequestIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
