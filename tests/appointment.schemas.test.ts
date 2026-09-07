import { describe, it, expect } from 'vitest'
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  appointmentIdParamSchema,
  appointmentStatusFilterSchema,
} from '../src/server/validation/appointment.schemas'

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000'
const VALID_ID_2 = '223e4567-e89b-12d3-a456-426614174000'
const VALID_ID_3 = '323e4567-e89b-12d3-a456-426614174000'

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: VALID_ID,
    vehicleId: VALID_ID_2,
    serviceId: VALID_ID_3,
    startAt: '2026-09-07T09:00:00Z',
    endAt: '2026-09-07T10:00:00Z',
    ...overrides,
  }
}

describe('createAppointmentSchema', () => {
  it('accepts a valid payload and parses startAt/endAt into Dates', () => {
    const result = createAppointmentSchema.parse(basePayload())
    expect(result.startAt).toBeInstanceOf(Date)
    expect(result.endAt).toBeInstanceOf(Date)
  })

  it('accepts an offset (non-Z) ISO datetime', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T14:00:00+05:00', endAt: '2026-09-07T15:00:00+05:00' }))
    ).not.toThrow()
  })

  it('rejects a missing customerId/vehicleId/serviceId', () => {
    const { customerId: _c, ...withoutCustomer } = basePayload()
    expect(() => createAppointmentSchema.parse(withoutCustomer)).toThrow()
    const { vehicleId: _v, ...withoutVehicle } = basePayload()
    expect(() => createAppointmentSchema.parse(withoutVehicle)).toThrow()
    const { serviceId: _s, ...withoutService } = basePayload()
    expect(() => createAppointmentSchema.parse(withoutService)).toThrow()
  })

  it('rejects missing startAt/endAt', () => {
    const { startAt: _sa, ...withoutStart } = basePayload()
    expect(() => createAppointmentSchema.parse(withoutStart)).toThrow()
    const { endAt: _ea, ...withoutEnd } = basePayload()
    expect(() => createAppointmentSchema.parse(withoutEnd)).toThrow()
  })

  it('rejects an invalid datetime string', () => {
    expect(() => createAppointmentSchema.parse(basePayload({ startAt: 'not-a-date' }))).toThrow()
  })

  it('rejects endAt <= startAt', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T10:00:00Z', endAt: '2026-09-07T10:00:00Z' }))
    ).toThrow()
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T10:00:00Z', endAt: '2026-09-07T09:00:00Z' }))
    ).toThrow()
  })

  it('rejects a duration under 15 minutes', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T09:00:00Z', endAt: '2026-09-07T09:10:00Z' }))
    ).toThrow()
  })

  it('accepts a duration of exactly 15 minutes', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T09:00:00Z', endAt: '2026-09-07T09:15:00Z' }))
    ).not.toThrow()
  })

  it('rejects a duration over 24 hours', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T09:00:00Z', endAt: '2026-09-08T09:00:01Z' }))
    ).toThrow()
  })

  it('accepts a duration of exactly 24 hours', () => {
    expect(() =>
      createAppointmentSchema.parse(basePayload({ startAt: '2026-09-07T09:00:00Z', endAt: '2026-09-08T09:00:00Z' }))
    ).not.toThrow()
  })

  it('rejects a disallowed create status', () => {
    expect(() => createAppointmentSchema.parse(basePayload({ status: 'COMPLETED' }))).toThrow()
    expect(() => createAppointmentSchema.parse(basePayload({ status: 'CANCELLED' }))).toThrow()
    expect(() => createAppointmentSchema.parse(basePayload({ status: 'IN_PROGRESS' }))).toThrow()
  })

  it('accepts SCHEDULED as the create status', () => {
    expect(() => createAppointmentSchema.parse(basePayload({ status: 'SCHEDULED' }))).not.toThrow()
  })

  it('rejects notes over the max length', () => {
    expect(() => createAppointmentSchema.parse(basePayload({ notes: 'a'.repeat(5001) }))).toThrow()
  })

  it('treats blank notes as null', () => {
    const result = createAppointmentSchema.parse(basePayload({ notes: '   ' }))
    expect(result.notes).toBeNull()
  })
})

describe('updateAppointmentSchema', () => {
  it('accepts a status-only update', () => {
    expect(() => updateAppointmentSchema.parse({ status: 'CONFIRMED' })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateAppointmentSchema.parse({})).toThrow()
  })

  it('rejects an invalid status value', () => {
    expect(() => updateAppointmentSchema.parse({ status: 'NOT_REAL' })).toThrow()
  })

  it('allows any enum status in an update (transition legality is a service-layer concern)', () => {
    expect(() => updateAppointmentSchema.parse({ status: 'COMPLETED' })).not.toThrow()
  })

  it('validates duration only when both startAt and endAt are present together', () => {
    // Only startAt provided: schema can't know the effective duration yet — no throw here.
    expect(() => updateAppointmentSchema.parse({ startAt: '2026-09-07T09:00:00Z' })).not.toThrow()
    // Both provided and invalid: caught immediately.
    expect(() =>
      updateAppointmentSchema.parse({ startAt: '2026-09-07T10:00:00Z', endAt: '2026-09-07T09:00:00Z' })
    ).toThrow()
  })

  it('a field omitted from the update payload is absent from the parsed result (leave-unchanged)', () => {
    const result = updateAppointmentSchema.parse({ status: 'CONFIRMED' }) as Record<string, unknown>
    expect('customerId' in result).toBe(false)
    expect('startAt' in result).toBe(false)
  })
})

describe('appointmentIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => appointmentIdParamSchema.parse(VALID_ID)).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => appointmentIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})

describe('appointmentStatusFilterSchema', () => {
  it('accepts a valid status', () => {
    expect(() => appointmentStatusFilterSchema.parse('SCHEDULED')).not.toThrow()
  })

  it('rejects an unknown status', () => {
    expect(() => appointmentStatusFilterSchema.parse('UNKNOWN')).toThrow()
  })
})
