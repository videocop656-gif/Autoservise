// ---------------------------------------------------------------------------
// Prompt 51 — Booking Availability UX: pure helpers behind
// AppointmentTimeField. No scheduling rule lives here — working hours,
// service duration, capacity and vehicle conflicts are all decided by
// GET /api/appointments/availability (server); this file only builds the
// requests and keeps the form's selected time consistent with what the
// server last returned.
// ---------------------------------------------------------------------------

/** One bookable slot, as returned by the day mode of GET /api/appointments/availability. */
export interface AvailabilitySlotDto {
  startAt: string
  endAt: string
  /** "HH:mm" in the business timezone. */
  localStart: string
  localEnd: string
}

export interface DayAvailabilityDto {
  date: string
  timezone: string
  slots: AvailabilitySlotDto[]
}

export interface IntervalAvailabilityDto {
  available: boolean
  reasons: { code: string; message: string }[]
}

export interface AppointmentTime {
  /** Business-local "YYYY-MM-DD". */
  date: string
  /** Business-local "HH:mm", '' when no time is chosen. */
  startTime: string
  endTime: string
}

interface AvailabilityScope {
  serviceId: string
  vehicleId?: string
  /** The appointment being rescheduled — never blocks its own new slot. */
  excludeAppointmentId?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function withScope(params: URLSearchParams, scope: AvailabilityScope): string {
  if (scope.vehicleId) params.set('vehicleId', scope.vehicleId)
  if (scope.excludeAppointmentId) params.set('excludeAppointmentId', scope.excludeAppointmentId)
  return `/api/appointments/availability?${params.toString()}`
}

/** Day-mode request path, or null while the form can't ask yet (no service or no complete date). */
export function dayAvailabilityPath(date: string, scope: AvailabilityScope): string | null {
  if (!scope.serviceId || !DATE_RE.test(date)) return null
  return withScope(new URLSearchParams({ date, serviceId: scope.serviceId }), scope)
}

/** Interval-mode request path for a manually typed time (UTC ISO bounds), or null if incomplete. */
export function intervalAvailabilityPath(startAt: string | null, endAt: string | null, scope: AvailabilityScope): string | null {
  if (!scope.serviceId || !startAt || !endAt) return null
  return withScope(new URLSearchParams({ serviceId: scope.serviceId, startAt, endAt }), scope)
}

export function isCompleteTime(value: string): boolean {
  return TIME_RE.test(value)
}

/** The slot the form's current start/end correspond to, if the server offered it. */
export function findSelectedSlot(slots: readonly AvailabilitySlotDto[], time: Pick<AppointmentTime, 'startTime' | 'endTime'>): AvailabilitySlotDto | undefined {
  return slots.find((s) => s.localStart === time.startTime && s.localEnd === time.endTime)
}

/**
 * After a (re)load of slots — new date, service, vehicle, or a refresh after
 * a 409 — keep the operator's time only if the server still offers a slot
 * starting then (taking that slot's end, i.e. the service duration);
 * otherwise clear it. Never keeps a time the server didn't just confirm.
 */
export function reconcileSelection(
  wantedStart: string,
  slots: readonly AvailabilitySlotDto[]
): Pick<AppointmentTime, 'startTime' | 'endTime'> {
  const slot = wantedStart ? slots.find((s) => s.localStart === wantedStart) : undefined
  return slot ? { startTime: slot.localStart, endTime: slot.localEnd } : { startTime: '', endTime: '' }
}

/** API error codes that mean "this time is no longer bookable" — the form reloads slots on these. */
export function isSchedulingConflict(code: string | undefined): boolean {
  return code === 'CAPACITY_EXCEEDED' || code === 'APPOINTMENT_CONFLICT'
}

/**
 * Russian operator message for a failed create/reschedule. Scheduling
 * conflicts get a "pick another time" message (the slot list is reloaded
 * right after); everything else keeps the form's existing behaviour.
 */
export function bookingErrorMessage(code: string | undefined, fallback: string): string {
  if (code === 'CAPACITY_EXCEEDED') return 'На выбранное время уже нет свободных постов. Выберите другое время.'
  if (code === 'APPOINTMENT_CONFLICT') return 'У этого автомобиля уже есть запись на это время. Выберите другое время.'
  return fallback
}

/** Russian message when Save is pressed without a complete date + time. */
export function missingTimeMessage(time: AppointmentTime): string | null {
  if (!DATE_RE.test(time.date)) return 'Выберите дату.'
  if (!isCompleteTime(time.startTime) || !isCompleteTime(time.endTime)) return 'Выберите время.'
  return null
}
