// ---------------------------------------------------------------------------
// Prompt 56 — pure helpers behind RequestBookingSection. No booking rule
// lives here: readiness, availability and the booking itself are decided by
// the server (GET/POST /api/customer-requests/:id/booking and the Prompt 51
// availability endpoint). This file only formats what the server returned.
// ---------------------------------------------------------------------------

import type { AppointmentStatus, CustomerRequestStatus } from './shared'

export type BookingStateKind = 'booked' | 'ready' | 'not_ready' | 'closed' | 'inconsistent'

export interface RequestBookingDto {
  requestId: string
  requestStatus: CustomerRequestStatus
  requestUpdatedAt: string
  timezone: string
  state: BookingStateKind
  missing: string[]
  convertsRequest: boolean
  customer: { id: string; name: string; phone: string; isActive: boolean }
  vehicle: { id: string; label: string; isActive: boolean } | null
  service: { id: string; name: string; durationMinutes: number; isActive: boolean } | null
  preference: { date: string | null; timeFrom: string | null; timeTo: string | null }
  appointment: {
    id: string
    startAt: string
    endAt: string
    status: AppointmentStatus
    localDate: string
    localStart: string
    localEnd: string
    vehicleLabel: string | null
    serviceName: string | null
  } | null
}

export type BookingPreference = RequestBookingDto['preference']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** "2026-10-02" → «2 октября» (with the year only when it isn't `currentYear`). */
export function formatBookingDate(dateKey: string, currentYear = new Date().getFullYear()): string {
  if (!DATE_RE.test(dateKey)) return dateKey
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' }
  if (y !== currentYear) opts.year = 'numeric'
  return new Intl.DateTimeFormat('ru-RU', opts).format(date).replace(/\s?г\.$/, '')
}

/** «после 15:00» / «до 18:00» / «с 15:00 до 18:00», or null when the customer named no time. */
export function preferenceTimeText(pref: BookingPreference): string | null {
  if (pref.timeFrom && pref.timeTo) return `с ${pref.timeFrom} до ${pref.timeTo}`
  if (pref.timeFrom) return `после ${pref.timeFrom}`
  if (pref.timeTo) return `до ${pref.timeTo}`
  return null
}

/** The customer's wish in one line — explicitly a wish, never a booked time. */
export function preferenceText(pref: BookingPreference, currentYear?: number): string | null {
  const parts = [pref.date ? formatBookingDate(pref.date, currentYear) : null, preferenceTimeText(pref)].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Does a free slot fit the customer's preferred time window? Used only to
 * highlight slots — every other free slot stays selectable. "from" is a
 * start no earlier than it; "to" is an end no later than it.
 */
export function isPreferredSlot(slot: { localStart: string; localEnd: string }, pref: BookingPreference): boolean {
  if (!pref.timeFrom && !pref.timeTo) return false
  if (pref.timeFrom && slot.localStart < pref.timeFrom) return false
  if (pref.timeTo && slot.localEnd > pref.timeTo) return false
  return true
}

/** The date the slot picker opens on: the preferred date unless it has already passed. */
export function initialBookingDate(pref: BookingPreference, todayKey: string): string {
  return pref.date && pref.date >= todayKey ? pref.date : ''
}

export function missingText(missing: readonly string[]): string {
  return missing.length > 0 ? `Для записи не хватает: ${missing.join(', ')}` : ''
}

/** «2 октября · 15:30». */
export function bookedLine(appointment: Pick<NonNullable<RequestBookingDto['appointment']>, 'localDate' | 'localStart'>, currentYear?: number): string {
  return `${formatBookingDate(appointment.localDate, currentYear)} · ${appointment.localStart}`
}

export function durationText(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return h === 1 ? '60 минут' : `${h} ч`
  }
  return minutes > 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} минут`
}

/** Errors after which the chosen time is gone: clear it and re-ask the server for slots. */
export function isSlotGoneCode(code: string | undefined): boolean {
  return code === 'CAPACITY_EXCEEDED' || code === 'APPOINTMENT_CONFLICT' || code === 'OUTSIDE_WORKING_HOURS' || code === 'BOOKING_TIME_PASSED'
}

/** Errors after which the request itself must be re-read (changed, service gone, already finished…). */
export function isRequestChangedCode(code: string | undefined): boolean {
  return (
    code === 'BOOKING_STALE' ||
    code === 'BOOKING_NOT_READY' ||
    code === 'SERVICE_INACTIVE' ||
    code === 'VEHICLE_INACTIVE' ||
    code === 'CUSTOMER_INACTIVE' ||
    code === 'REQUEST_FINISHED' ||
    code === 'REQUEST_INCONSISTENT' ||
    code === 'NOT_FOUND'
  )
}

export const CONFIRM_FAILED = 'Не удалось создать запись. Попробуйте ещё раз.'

/** The server's messages are already operator-facing Russian; only generic failures get a fallback. */
export function confirmErrorMessage(code: string | undefined, message: string | undefined): string {
  if (!code || code === 'INTERNAL_ERROR' || code === 'VALIDATION_ERROR' || !message) {
    return code === 'VALIDATION_ERROR' ? 'Проверьте выбранное время.' : CONFIRM_FAILED
  }
  return message
}

/** Operator notice after a confirmation, depending on what the server did with the request status. */
export function bookedNotice(created: boolean, booking: RequestBookingDto): string {
  if (!created) return 'Запись по этой заявке уже существует — новая не создана.'
  return booking.requestStatus === 'CONVERTED' ? 'Запись создана. Заявка преобразована в запись.' : 'Запись создана и связана с заявкой.'
}
