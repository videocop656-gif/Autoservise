import { describe, it, expect } from 'vitest'
import {
  createServiceRecordSchema,
  updateServiceRecordSchema,
  serviceRecordIdParamSchema,
} from '../src/server/validation/serviceRecord.schemas'

const CUSTOMER_ID = '123e4567-e89b-12d3-a456-426614174000'
const VEHICLE_ID = '223e4567-e89b-12d3-a456-426614174000'
const SERVICE_ID = '323e4567-e89b-12d3-a456-426614174000'
const APPOINTMENT_ID = '423e4567-e89b-12d3-a456-426614174000'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: CUSTOMER_ID,
    vehicleId: VEHICLE_ID,
    serviceId: SERVICE_ID,
    performedAt: '2026-09-07T09:00:00Z',
    totalPrice: 1500,
    workDescription: 'Replaced oil and filter',
    ...overrides,
  }
}

describe('createServiceRecordSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = createServiceRecordSchema.parse(basePayload())
    expect(result.performedAt).toBeInstanceOf(Date)
    expect(result.totalPrice).toBe(1500)
  })

  it('accepts an optional appointmentId', () => {
    const result = createServiceRecordSchema.parse(basePayload({ appointmentId: APPOINTMENT_ID }))
    expect(result.appointmentId).toBe(APPOINTMENT_ID)
  })

  it('treats an empty-string appointmentId as null', () => {
    const result = createServiceRecordSchema.parse(basePayload({ appointmentId: '' }))
    expect(result.appointmentId).toBeNull()
  })

  it('does not accept isArchived (create is always active)', () => {
    const result = createServiceRecordSchema.parse(basePayload()) as Record<string, unknown>
    expect('isArchived' in result).toBe(false)
  })

  it('rejects missing customerId/vehicleId/serviceId', () => {
    const { customerId: _c, ...withoutCustomer } = basePayload()
    expect(() => createServiceRecordSchema.parse(withoutCustomer)).toThrow()
    const { vehicleId: _v, ...withoutVehicle } = basePayload()
    expect(() => createServiceRecordSchema.parse(withoutVehicle)).toThrow()
    const { serviceId: _s, ...withoutService } = basePayload()
    expect(() => createServiceRecordSchema.parse(withoutService)).toThrow()
  })

  it('rejects a missing performedAt', () => {
    const { performedAt: _p, ...withoutDate } = basePayload()
    expect(() => createServiceRecordSchema.parse(withoutDate)).toThrow()
  })

  it('rejects an invalid performedAt', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ performedAt: 'not-a-date' }))).toThrow()
  })

  it('rejects a missing totalPrice', () => {
    const { totalPrice: _t, ...withoutPrice } = basePayload()
    expect(() => createServiceRecordSchema.parse(withoutPrice)).toThrow()
  })

  it('rejects a negative totalPrice', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ totalPrice: -1 }))).toThrow()
  })

  it('rejects negative mileage', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ mileage: -1 }))).toThrow()
  })

  it('rejects mileage over 2,000,000', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ mileage: 2_000_001 }))).toThrow()
  })

  it('accepts mileage at the boundary (0 and 2,000,000)', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ mileage: 0 }))).not.toThrow()
    expect(() => createServiceRecordSchema.parse(basePayload({ mileage: 2_000_000 }))).not.toThrow()
  })

  it('rejects an empty workDescription', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ workDescription: '' }))).toThrow()
    expect(() => createServiceRecordSchema.parse(basePayload({ workDescription: '   ' }))).toThrow()
  })

  it('rejects workDescription over the max length', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ workDescription: 'a'.repeat(10001) }))).toThrow()
  })

  it('rejects partsDescription/recommendations over the max length', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ partsDescription: 'a'.repeat(10001) }))).toThrow()
    expect(() => createServiceRecordSchema.parse(basePayload({ recommendations: 'a'.repeat(10001) }))).toThrow()
  })

  it('rejects notes over the max length', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ notes: 'a'.repeat(5001) }))).toThrow()
  })

  it('treats blank optional text fields as null', () => {
    const result = createServiceRecordSchema.parse(basePayload({ partsDescription: '  ', recommendations: '', notes: '   ' }))
    expect(result.partsDescription).toBeNull()
    expect(result.recommendations).toBeNull()
    expect(result.notes).toBeNull()
  })

  it('rejects an unsupported currency', () => {
    expect(() => createServiceRecordSchema.parse(basePayload({ currency: 'GBP' }))).toThrow()
  })
})

describe('updateServiceRecordSchema', () => {
  it('accepts an archive-only update', () => {
    expect(() => updateServiceRecordSchema.parse({ isArchived: true })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateServiceRecordSchema.parse({})).toThrow()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateServiceRecordSchema.parse({ isArchived: true }) as Record<string, unknown>
    expect('workDescription' in result).toBe(false)
    expect('mileage' in result).toBe(false)
  })

  it('allows clearing appointmentId to null', () => {
    const result = updateServiceRecordSchema.parse({ appointmentId: null })
    expect(result.appointmentId).toBeNull()
  })

  it('rejects clearing the required workDescription via an empty string', () => {
    expect(() => updateServiceRecordSchema.parse({ workDescription: '' })).toThrow()
  })
})

describe('serviceRecordIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => serviceRecordIdParamSchema.parse(CUSTOMER_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => serviceRecordIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
