import { describe, expect, it } from 'vitest'
import { createServiceSchema, updateServiceSchema } from '../src/server/validation/service.schemas'
import {
  businessDateSchema,
  serviceFollowUpStatusQuerySchema,
  updateServiceFollowUpSchema,
} from '../src/server/validation/serviceFollowUp.schemas'
import { createServiceRecordSchema, updateServiceRecordSchema } from '../src/server/validation/serviceRecord.schemas'

// Prompt 48 — data validation (spec §20).

const baseService = { name: 'Замена масла', durationMinutes: 60 }

describe('Service.repeatIntervalDays', () => {
  it('accepts null (not set) and omission (existing clients keep working)', () => {
    expect(createServiceSchema.safeParse({ ...baseService, repeatIntervalDays: null }).success).toBe(true)
    expect(createServiceSchema.safeParse(baseService).success).toBe(true)
  })

  it('accepts a positive whole number of days', () => {
    expect(createServiceSchema.parse({ ...baseService, repeatIntervalDays: 180 }).repeatIntervalDays).toBe(180)
    expect(updateServiceSchema.parse({ repeatIntervalDays: 1 }).repeatIntervalDays).toBe(1)
  })

  it.each([0, -30, 1.5])('rejects %s', (value) => {
    expect(createServiceSchema.safeParse({ ...baseService, repeatIntervalDays: value }).success).toBe(false)
    expect(updateServiceSchema.safeParse({ repeatIntervalDays: value }).success).toBe(false)
  })

  it('rejects a numeric string (no text intervals like "180" or "через полгода")', () => {
    expect(updateServiceSchema.safeParse({ repeatIntervalDays: '180' }).success).toBe(false)
    expect(updateServiceSchema.safeParse({ repeatIntervalDays: 'через полгода' }).success).toBe(false)
  })

  it('PATCH can clear the interval back to "not set"', () => {
    expect(updateServiceSchema.parse({ repeatIntervalDays: null }).repeatIntervalDays).toBeNull()
  })
})

describe('follow-up due date ("YYYY-MM-DD", Business-local day)', () => {
  it('accepts a real calendar day', () => {
    expect(businessDateSchema.safeParse('2027-03-28').success).toBe(true)
    expect(businessDateSchema.safeParse('2028-02-29').success).toBe(true)
  })

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-9-1', '28.03.2027', '2026-09-29T10:00:00Z', ''])(
    'rejects %s',
    (value) => {
      expect(businessDateSchema.safeParse(value).success).toBe(false)
    }
  )

  it('ServiceRecord followUpDueDate: "" and null mean "no follow-up", omission means "not sent"', () => {
    const base = {
      customerId: '11111111-1111-4111-8111-111111111111',
      vehicleId: '22222222-2222-4222-8222-222222222222',
      serviceId: '33333333-3333-4333-8333-333333333333',
      performedAt: '2026-09-29T10:00:00.000Z',
      totalPrice: 100,
      workDescription: 'Работа',
    }
    expect(createServiceRecordSchema.parse({ ...base, followUpDueDate: '' }).followUpDueDate).toBeNull()
    expect(createServiceRecordSchema.parse({ ...base, followUpDueDate: null }).followUpDueDate).toBeNull()
    expect(createServiceRecordSchema.parse(base).followUpDueDate).toBeUndefined()
    expect(createServiceRecordSchema.parse({ ...base, followUpDueDate: '2027-03-28' }).followUpDueDate).toBe('2027-03-28')
    expect(createServiceRecordSchema.safeParse({ ...base, followUpDueDate: '2026-02-30' }).success).toBe(false)
    expect(updateServiceRecordSchema.parse({ followUpDueDate: '2027-01-15' }).followUpDueDate).toBe('2027-01-15')
  })
})

describe('follow-up status', () => {
  it.each(['PENDING', 'CONTACTED', 'BOOKED', 'DISMISSED'])('accepts %s', (status) => {
    expect(serviceFollowUpStatusQuerySchema.safeParse(status).success).toBe(true)
    expect(updateServiceFollowUpSchema.safeParse({ status }).success).toBe(true)
  })

  it.each(['SNOOZED', 'pending', 'CLOSED', ''])('rejects %s', (status) => {
    expect(serviceFollowUpStatusQuerySchema.safeParse(status).success).toBe(false)
    expect(updateServiceFollowUpSchema.safeParse({ status }).success).toBe(false)
  })

  it('PATCH accepts only status, dueAt and note — and at least one of them', () => {
    expect(updateServiceFollowUpSchema.safeParse({}).success).toBe(false)
    expect(updateServiceFollowUpSchema.parse({ dueAt: '2026-10-15', note: 'Позвонить утром' })).toEqual({
      dueAt: '2026-10-15',
      note: 'Позвонить утром',
    })
    // Unknown keys (e.g. an attempt to relink ownership) are stripped, never applied.
    expect(updateServiceFollowUpSchema.parse({ note: 'x', customerId: 'other', tenantId: 'other' })).toEqual({ note: 'x' })
  })
})
