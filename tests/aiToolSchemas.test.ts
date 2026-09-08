import { describe, it, expect } from 'vitest'
import {
  checkAvailabilityToolSchema,
  createAppointmentToolSchema,
  rescheduleAppointmentToolSchema,
  cancelAppointmentToolSchema,
} from '../src/server/ai/tools/schemas'

const SERVICE_ID = '123e4567-e89b-12d3-a456-426614174000'
const CUSTOMER_ID = '223e4567-e89b-12d3-a456-426614174000'
const VEHICLE_ID = '323e4567-e89b-12d3-a456-426614174000'
const APPOINTMENT_ID = '423e4567-e89b-12d3-a456-426614174000'

describe('checkAvailabilityToolSchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(() => checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '2026-09-16' })).not.toThrow()
  })

  it('accepts optional customerId/vehicleId/preferredTimeFrom/preferredTimeTo', () => {
    const result = checkAvailabilityToolSchema.parse({
      serviceId: SERVICE_ID,
      date: '2026-09-16',
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      preferredTimeFrom: '09:00',
      preferredTimeTo: '12:00',
    })
    expect(result.customerId).toBe(CUSTOMER_ID)
  })

  it('treats empty-string optional fields as null', () => {
    const result = checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '2026-09-16', customerId: '', vehicleId: '' })
    expect(result.customerId).toBeNull()
    expect(result.vehicleId).toBeNull()
  })

  it('rejects a missing serviceId', () => {
    expect(() => checkAvailabilityToolSchema.parse({ date: '2026-09-16' })).toThrow()
  })

  it('rejects an invalid serviceId (not a real id)', () => {
    expect(() => checkAvailabilityToolSchema.parse({ serviceId: 'not-a-uuid', date: '2026-09-16' })).toThrow()
  })

  it('rejects an invalid date format', () => {
    expect(() => checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '16-09-2026' })).toThrow()
    expect(() => checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '2026-09-16T00:00:00Z' })).toThrow()
  })

  it('rejects an invalid time format', () => {
    expect(() =>
      checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '2026-09-16', preferredTimeFrom: '9:00' })
    ).toThrow()
    expect(() =>
      checkAvailabilityToolSchema.parse({ serviceId: SERVICE_ID, date: '2026-09-16', preferredTimeFrom: '25:00' })
    ).toThrow()
  })
})

describe('createAppointmentToolSchema', () => {
  function valid(overrides: Record<string, unknown> = {}) {
    return {
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      serviceId: SERVICE_ID,
      startAt: '2026-09-16T06:00:00Z',
      endAt: '2026-09-16T07:00:00Z',
      ...overrides,
    }
  }

  it('accepts a valid payload and transforms startAt/endAt to Date', () => {
    const result = createAppointmentToolSchema.parse(valid())
    expect(result.startAt).toBeInstanceOf(Date)
    expect(result.endAt).toBeInstanceOf(Date)
  })

  it('rejects missing required ids', () => {
    const { customerId: _c, ...rest } = valid()
    expect(() => createAppointmentToolSchema.parse(rest)).toThrow()
  })

  it('rejects an invalid id (not a UUID) — the model may never invent one', () => {
    expect(() => createAppointmentToolSchema.parse(valid({ customerId: 'invented-id' }))).toThrow()
  })

  it('rejects a datetime without a timezone offset', () => {
    expect(() => createAppointmentToolSchema.parse(valid({ startAt: '2026-09-16T06:00:00' }))).toThrow()
  })

  it('accepts an optional notes field, treating blank as null', () => {
    expect(createAppointmentToolSchema.parse(valid({ notes: '' })).notes).toBeNull()
  })
})

describe('rescheduleAppointmentToolSchema', () => {
  it('accepts a valid payload', () => {
    const result = rescheduleAppointmentToolSchema.parse({
      appointmentId: APPOINTMENT_ID,
      startAt: '2026-09-16T06:00:00Z',
      endAt: '2026-09-16T07:00:00Z',
    })
    expect(result.appointmentId).toBe(APPOINTMENT_ID)
  })

  it('rejects a missing appointmentId', () => {
    expect(() => rescheduleAppointmentToolSchema.parse({ startAt: '2026-09-16T06:00:00Z', endAt: '2026-09-16T07:00:00Z' })).toThrow()
  })

  it('rejects an invented (non-UUID) appointmentId', () => {
    expect(() =>
      rescheduleAppointmentToolSchema.parse({ appointmentId: 'made-up', startAt: '2026-09-16T06:00:00Z', endAt: '2026-09-16T07:00:00Z' })
    ).toThrow()
  })
})

describe('cancelAppointmentToolSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => cancelAppointmentToolSchema.parse({ appointmentId: APPOINTMENT_ID })).not.toThrow()
  })

  it('rejects a missing appointmentId', () => {
    expect(() => cancelAppointmentToolSchema.parse({})).toThrow()
  })
})

describe('unknown tool arguments (registry-level rejection is tested in aiToolRegistry.test.ts)', () => {
  it('every schema rejects a completely unrelated shape', () => {
    expect(() => checkAvailabilityToolSchema.parse({ foo: 'bar' })).toThrow()
    expect(() => createAppointmentToolSchema.parse({ foo: 'bar' })).toThrow()
    expect(() => rescheduleAppointmentToolSchema.parse({ foo: 'bar' })).toThrow()
    expect(() => cancelAppointmentToolSchema.parse({ foo: 'bar' })).toThrow()
  })
})
