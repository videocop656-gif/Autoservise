import { describe, it, expect } from 'vitest'
import {
  dayAvailabilityPath,
  intervalAvailabilityPath,
  findSelectedSlot,
  reconcileSelection,
  isSchedulingConflict,
  bookingErrorMessage,
  missingTimeMessage,
  isCompleteTime,
  type AvailabilitySlotDto,
} from '../src/components/appointments/availability'

// Prompt 51 — the pure helpers behind AppointmentTimeField (the project has
// no component-test stack; the interactive states are browser-validated, see
// final-report-51.md). No scheduling rule is decided here — these only build
// requests and keep the selected time in line with the server's answer.

const SERVICE = '33333333-3333-4333-8333-333333333333'
const VEHICLE = '22222222-2222-4222-8222-000000000001'
const APPOINTMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'

const slot = (localStart: string, localEnd: string): AvailabilitySlotDto => ({ startAt: '', endAt: '', localStart, localEnd })
const SLOTS = [slot('09:00', '10:00'), slot('09:30', '10:30'), slot('11:00', '12:00')]

describe('dayAvailabilityPath', () => {
  it('asks the day mode of the existing endpoint with the business-local date and service', () => {
    expect(dayAvailabilityPath('2026-10-05', { serviceId: SERVICE })).toBe(`/api/appointments/availability?date=2026-10-05&serviceId=${SERVICE}`)
  })

  it('adds vehicle and the rescheduled appointment when known', () => {
    const path = dayAvailabilityPath('2026-10-05', { serviceId: SERVICE, vehicleId: VEHICLE, excludeAppointmentId: APPOINTMENT })!
    const params = new URL(path, 'http://x').searchParams
    expect(params.get('vehicleId')).toBe(VEHICLE)
    expect(params.get('excludeAppointmentId')).toBe(APPOINTMENT)
  })

  it('does not ask while the service or a complete date is missing', () => {
    expect(dayAvailabilityPath('2026-10-05', { serviceId: '' })).toBeNull()
    expect(dayAvailabilityPath('', { serviceId: SERVICE })).toBeNull()
    expect(dayAvailabilityPath('2026-10', { serviceId: SERVICE })).toBeNull()
  })
})

describe('intervalAvailabilityPath (manual time check)', () => {
  it('sends UTC bounds as given, URL-encoded', () => {
    const path = intervalAvailabilityPath('2026-10-05T07:00:00.000Z', '2026-10-05T08:30:00.000Z', { serviceId: SERVICE })!
    const params = new URL(path, 'http://x').searchParams
    expect(params.get('startAt')).toBe('2026-10-05T07:00:00.000Z')
    expect(params.get('endAt')).toBe('2026-10-05T08:30:00.000Z')
    expect(params.has('date')).toBe(false)
  })

  it('is null when incomplete', () => {
    expect(intervalAvailabilityPath(null, '2026-10-05T08:30:00.000Z', { serviceId: SERVICE })).toBeNull()
    expect(intervalAvailabilityPath('2026-10-05T07:00:00.000Z', '2026-10-05T08:30:00.000Z', { serviceId: '' })).toBeNull()
  })
})

describe('selection vs. the server answer', () => {
  it('findSelectedSlot matches start AND end (a custom-length time is not a generated slot)', () => {
    expect(findSelectedSlot(SLOTS, { startTime: '09:30', endTime: '10:30' })).toEqual(SLOTS[1])
    expect(findSelectedSlot(SLOTS, { startTime: '09:30', endTime: '11:00' })).toBeUndefined()
  })

  it('keeps a time the new answer still offers, taking that slot end (service duration)', () => {
    expect(reconcileSelection('11:00', SLOTS)).toEqual({ startTime: '11:00', endTime: '12:00' })
  })

  it('clears a time the new answer no longer offers — a stale slot is never kept', () => {
    expect(reconcileSelection('10:00', SLOTS)).toEqual({ startTime: '', endTime: '' })
    expect(reconcileSelection('09:00', [])).toEqual({ startTime: '', endTime: '' })
  })

  it('nothing selected stays nothing selected', () => {
    expect(reconcileSelection('', SLOTS)).toEqual({ startTime: '', endTime: '' })
  })
})

describe('Save-time messages', () => {
  it('scheduling conflicts (409) are recognised and explained in Russian', () => {
    expect(isSchedulingConflict('CAPACITY_EXCEEDED')).toBe(true)
    expect(isSchedulingConflict('APPOINTMENT_CONFLICT')).toBe(true)
    expect(isSchedulingConflict('VALIDATION_ERROR')).toBe(false)
    expect(bookingErrorMessage('CAPACITY_EXCEEDED', 'x')).toBe('На выбранное время уже нет свободных постов. Выберите другое время.')
    expect(bookingErrorMessage('APPOINTMENT_CONFLICT', 'x')).toBe('У этого автомобиля уже есть запись на это время. Выберите другое время.')
    expect(bookingErrorMessage('VALIDATION_ERROR', 'Проверьте поля.')).toBe('Проверьте поля.')
  })

  it('Save without a date or time says so before calling the server', () => {
    expect(missingTimeMessage({ date: '', startTime: '10:00', endTime: '11:00' })).toBe('Выберите дату.')
    expect(missingTimeMessage({ date: '2026-10-05', startTime: '', endTime: '' })).toBe('Выберите время.')
    expect(missingTimeMessage({ date: '2026-10-05', startTime: '10:00', endTime: '11:00' })).toBeNull()
  })

  it('isCompleteTime accepts only real HH:mm', () => {
    expect(isCompleteTime('09:30')).toBe(true)
    expect(isCompleteTime('9:30')).toBe(false)
    expect(isCompleteTime('24:00')).toBe(false)
    expect(isCompleteTime('')).toBe(false)
  })
})
