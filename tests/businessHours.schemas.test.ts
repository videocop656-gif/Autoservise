import { describe, it, expect } from 'vitest'
import { workingHoursListSchema } from '../src/server/validation/businessHours.schemas'

const FULL_WEEK = [
  { dayOfWeek: 'MONDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'TUESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'WEDNESDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'THURSDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'FRIDAY', isOpen: true, openTime: '09:00', closeTime: '18:00' },
  { dayOfWeek: 'SATURDAY', isOpen: true, openTime: '10:00', closeTime: '15:00' },
  { dayOfWeek: 'SUNDAY', isOpen: false, openTime: null, closeTime: null },
] as const

describe('workingHoursListSchema', () => {
  it('accepts a valid full week', () => {
    expect(() => workingHoursListSchema.parse(FULL_WEEK)).not.toThrow()
  })

  it('rejects a duplicate day', () => {
    const days = [...FULL_WEEK.slice(0, 6), FULL_WEEK[0]]
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })

  it('rejects a missing day (only 6 provided)', () => {
    expect(() => workingHoursListSchema.parse(FULL_WEEK.slice(0, 6))).toThrow()
  })

  it('rejects a closed day that has times set', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'SUNDAY' ? { ...d, isOpen: false, openTime: '09:00', closeTime: null } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })

  it('rejects an open day missing openTime', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, openTime: null } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })

  it('rejects an open day missing closeTime', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, closeTime: null } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })

  it('rejects closeTime earlier than or equal to openTime', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, openTime: '18:00', closeTime: '09:00' } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()

    const equalDays = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, openTime: '09:00', closeTime: '09:00' } : d))
    expect(() => workingHoursListSchema.parse(equalDays)).toThrow()
  })

  it('rejects a malformed time string', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, openTime: '9:00' } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })

  it('rejects an overnight shift (closeTime before openTime on the same record)', () => {
    const days = FULL_WEEK.map((d) => (d.dayOfWeek === 'MONDAY' ? { ...d, openTime: '22:00', closeTime: '02:00' } : d))
    expect(() => workingHoursListSchema.parse(days)).toThrow()
  })
})
