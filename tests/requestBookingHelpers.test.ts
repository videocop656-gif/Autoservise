import { describe, it, expect } from 'vitest'
import {
  formatBookingDate,
  preferenceText,
  preferenceTimeText,
  isPreferredSlot,
  initialBookingDate,
  missingText,
  bookedLine,
  durationText,
  isSlotGoneCode,
  isRequestChangedCode,
  confirmErrorMessage,
  bookedNotice,
  CONFIRM_FAILED,
  type RequestBookingDto,
} from '../src/components/requests/booking'

// Prompt 56 — pure helpers behind RequestBookingSection (formatting only;
// every booking rule is the server's).

const pref = (date: string | null, timeFrom: string | null, timeTo: string | null) => ({ date, timeFrom, timeTo })

describe('booking helpers', () => {
  it('formats a business-local date in Russian, with the year only when it differs', () => {
    expect(formatBookingDate('2026-10-02', 2026)).toBe('2 октября')
    expect(formatBookingDate('2027-01-15', 2026)).toBe('15 января 2027')
    expect(formatBookingDate('garbage', 2026)).toBe('garbage')
  })

  it('describes the preference as a wish', () => {
    expect(preferenceTimeText(pref(null, '15:00', null))).toBe('после 15:00')
    expect(preferenceTimeText(pref(null, null, '18:00'))).toBe('до 18:00')
    expect(preferenceTimeText(pref(null, '10:00', '12:00'))).toBe('с 10:00 до 12:00')
    expect(preferenceText(pref('2026-10-02', '15:00', null), 2026)).toBe('2 октября, после 15:00')
    expect(preferenceText(pref(null, null, null))).toBeNull()
  })

  it('highlights only slots inside the wished window; no window highlights nothing', () => {
    const slot = (localStart: string, localEnd: string) => ({ localStart, localEnd })
    expect(isPreferredSlot(slot('15:00', '16:00'), pref(null, '15:00', null))).toBe(true)
    expect(isPreferredSlot(slot('14:30', '15:30'), pref(null, '15:00', null))).toBe(false)
    expect(isPreferredSlot(slot('17:30', '18:30'), pref(null, null, '18:00'))).toBe(false)
    expect(isPreferredSlot(slot('10:00', '11:00'), pref('2026-10-02', null, null))).toBe(false)
  })

  it('opens on the preferred date unless it has passed', () => {
    expect(initialBookingDate(pref('2026-10-05', null, null), '2026-10-02')).toBe('2026-10-05')
    expect(initialBookingDate(pref('2026-10-01', null, null), '2026-10-02')).toBe('')
    expect(initialBookingDate(pref(null, null, null), '2026-10-02')).toBe('')
  })

  it('formats readiness, booked line and duration', () => {
    expect(missingText(['автомобиль', 'услуга'])).toBe('Для записи не хватает: автомобиль, услуга')
    expect(missingText([])).toBe('')
    expect(bookedLine({ localDate: '2026-10-02', localStart: '15:30' }, 2026)).toBe('2 октября · 15:30')
    expect(durationText(60)).toBe('60 минут')
    expect(durationText(45)).toBe('45 минут')
    expect(durationText(90)).toBe('1 ч 30 мин')
    expect(durationText(120)).toBe('2 ч')
  })

  it('classifies errors: slot gone → refresh slots; request changed → re-read the request', () => {
    for (const c of ['CAPACITY_EXCEEDED', 'APPOINTMENT_CONFLICT', 'OUTSIDE_WORKING_HOURS', 'BOOKING_TIME_PASSED']) {
      expect(isSlotGoneCode(c)).toBe(true)
      expect(isRequestChangedCode(c)).toBe(false)
    }
    for (const c of ['BOOKING_STALE', 'SERVICE_INACTIVE', 'BOOKING_NOT_READY', 'REQUEST_FINISHED', 'REQUEST_INCONSISTENT']) {
      expect(isRequestChangedCode(c)).toBe(true)
      expect(isSlotGoneCode(c)).toBe(false)
    }
  })

  it('shows the server Russian message, generic fallbacks otherwise', () => {
    expect(confirmErrorMessage('CAPACITY_EXCEEDED', 'Это время уже занято. Выберите другое свободное время.')).toBe('Это время уже занято. Выберите другое свободное время.')
    expect(confirmErrorMessage('INTERNAL_ERROR', 'boom')).toBe(CONFIRM_FAILED)
    expect(confirmErrorMessage(undefined, undefined)).toBe(CONFIRM_FAILED)
    expect(confirmErrorMessage('VALIDATION_ERROR', 'Invalid ISO')).toBe('Проверьте выбранное время.')
  })

  it('success notice reflects what the server did', () => {
    const b = (requestStatus: RequestBookingDto['requestStatus']) => ({ requestStatus }) as RequestBookingDto
    expect(bookedNotice(true, b('CONVERTED'))).toBe('Запись создана. Заявка преобразована в запись.')
    expect(bookedNotice(true, b('NEW'))).toBe('Запись создана и связана с заявкой.')
    expect(bookedNotice(false, b('CONVERTED'))).toBe('Запись по этой заявке уже существует — новая не создана.')
  })
})
