import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { zonedTimeToUtc } from '../../lib/businessTime'
import {
  type AppointmentTime,
  type AvailabilitySlotDto,
  type DayAvailabilityDto,
  type IntervalAvailabilityDto,
  dayAvailabilityPath,
  intervalAvailabilityPath,
  findSelectedSlot,
  reconcileSelection,
  isCompleteTime,
} from './availability'

// ---------------------------------------------------------------------------
// Prompt 51 — Booking Availability UX. Replaces the bare date / start / end
// inputs of the three appointment forms (Новая запись, Редактировать запись,
// Запись из заявки) with: an explicit date, then the server's free slots
// for that date (GET /api/appointments/availability, day mode — working
// hours, service duration, service-bay capacity, the vehicle's own bookings,
// the rescheduled appointment excluded). Times are business-local "HH:mm",
// exactly what the forms already convert with zonedTimeToUtc on Save.
//
// "Указать время вручную" keeps the old free-form start/end (e.g. a longer
// job than the service's standard duration); a typed interval is checked
// live with the same endpoint's interval mode, so it's never shown as
// verified unless the server said so. Either way the server re-checks
// everything on Save under the scheduling lock — this is assistance only.
// ---------------------------------------------------------------------------

export interface AppointmentTimeFieldProps {
  /** Prefix for input ids — keeps the forms' existing ids (`appt-date`, `appt-start`, `appt-end`). */
  idPrefix: string
  timezone: string
  serviceId: string
  vehicleId?: string
  /** Reschedule: the appointment being edited never blocks its own new slot. */
  excludeAppointmentId?: string
  value: AppointmentTime
  /** Partial update — callers merge it with a functional setState. */
  onChange: (patch: Partial<AppointmentTime>) => void
  /** Bump to re-ask the server (e.g. after a 409 on Save); a time it no longer offers is cleared. */
  reloadKey?: number
  /**
   * Reschedule: keep the appointment's current time as-is until the
   * operator changes the date, service or vehicle (or picks another slot),
   * even if it isn't one of the generated slots (custom duration, past).
   */
  preserveInitialTime?: boolean
}

type SlotState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; slots: AvailabilitySlotDto[] }
type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'bad'; messages: string[] }
  | { status: 'error' }

export function AppointmentTimeField({
  idPrefix,
  timezone,
  serviceId,
  vehicleId,
  excludeAppointmentId,
  value,
  onChange,
  reloadKey = 0,
  preserveInitialTime = false,
}: AppointmentTimeFieldProps) {
  const [mode, setMode] = useState<'slots' | 'manual'>('slots')
  const [slotState, setSlotState] = useState<SlotState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const [check, setCheck] = useState<CheckState>({ status: 'idle' })

  // Latest props for the async effects, without re-running them on every keystroke.
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const modeRef = useRef(mode)
  modeRef.current = mode

  const scope = { serviceId, vehicleId: vehicleId || undefined, excludeAppointmentId }
  const path = dayAvailabilityPath(value.date, scope)
  const requestKey = `${path ?? ''}|${reloadKey}`

  // The reschedule's current time stays untouched for the request it was
  // opened with; any change of date / service / vehicle / reload releases it.
  const pinnedKeyRef = useRef<string | null>(preserveInitialTime && value.startTime ? requestKey : null)

  useEffect(() => {
    if (!path) {
      setSlotState({ status: 'idle' })
      return
    }
    const pinned = pinnedKeyRef.current === requestKey
    if (!pinned) pinnedKeyRef.current = null
    const managed = modeRef.current === 'slots' && !pinned
    const wanted = valueRef.current.startTime

    // Never leave a time on the form that the server hasn't just offered:
    // clear it now, put it back only if the new answer still contains it.
    if (managed && wanted) onChangeRef.current({ startTime: '', endTime: '' })
    setSlotState({ status: 'loading' })

    let cancelled = false
    apiFetch<{ availability: DayAvailabilityDto }>(path).then(
      ({ availability }) => {
        if (cancelled) return
        setSlotState({ status: 'ready', slots: availability.slots })
        if (managed && wanted) onChangeRef.current(reconcileSelection(wanted, availability.slots))
      },
      () => {
        if (!cancelled) setSlotState({ status: 'error' })
      }
    )
    return () => {
      cancelled = true
    }
    // requestKey covers path + reloadKey; retryKey re-asks after a load error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, retryKey])

  // Manual mode: verify the typed interval with the same server rules.
  useEffect(() => {
    if (mode !== 'manual') return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !isCompleteTime(value.startTime) || !isCompleteTime(value.endTime)) {
      setCheck({ status: 'idle' })
      return
    }
    const startAt = zonedTimeToUtc(value.date, value.startTime, timezone).toISOString()
    const endAt = zonedTimeToUtc(value.date, value.endTime, timezone).toISOString()
    if (endAt <= startAt) {
      setCheck({ status: 'bad', messages: ['Окончание должно быть позже начала.'] })
      return
    }
    const intervalPath = intervalAvailabilityPath(startAt, endAt, scope)
    if (!intervalPath) {
      setCheck({ status: 'idle' })
      return
    }
    setCheck({ status: 'loading' })
    let cancelled = false
    const timer = setTimeout(() => {
      apiFetch<{ availability: IntervalAvailabilityDto }>(intervalPath).then(
        ({ availability }) => {
          if (cancelled) return
          setCheck(availability.available ? { status: 'ok' } : { status: 'bad', messages: availability.reasons.map((r) => r.message) })
        },
        (err: unknown) => {
          if (cancelled) return
          setCheck(
            err instanceof ApiClientError && err.status === 400
              ? { status: 'bad', messages: ['Длительность записи — от 15 минут до 24 часов.'] }
              : { status: 'error' }
          )
        }
      )
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, value.date, value.startTime, value.endTime, serviceId, vehicleId, excludeAppointmentId, timezone, reloadKey])

  function switchMode() {
    if (mode === 'slots') {
      setMode('manual')
      return
    }
    setMode('slots')
    // Back to slots: a typed time survives only if it is one of the offered slots.
    pinnedKeyRef.current = null
    const slots = slotState.status === 'ready' ? slotState.slots : []
    if (value.startTime && !findSelectedSlot(slots, value)) {
      onChange({ startTime: '', endTime: '' })
    }
  }

  const slots = slotState.status === 'ready' ? slotState.slots : []
  const selectedSlot = findSelectedSlot(slots, value)
  const hasTime = Boolean(value.startTime && value.endTime)
  const labelId = `${idPrefix}-time-label`

  return (
    <div className="space-y-4">
      <div className="space-y-2 sm:max-w-xs">
        <Label htmlFor={`${idPrefix}-date`}>Дата</Label>
        <Input id={`${idPrefix}-date`} type="date" required value={value.date} onChange={(e) => onChange({ date: e.target.value })} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span id={labelId} className="text-sm font-medium leading-none">
            Время
          </span>
          <button
            type="button"
            onClick={switchMode}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {mode === 'slots' ? 'Указать время вручную' : 'Выбрать из свободного времени'}
          </button>
        </div>

        {mode === 'slots' ? (
          <div className="space-y-2" aria-live="polite">
            {slotState.status === 'idle' && (
              <p className="text-sm text-muted-foreground">
                {serviceId ? 'Выберите дату, чтобы увидеть свободное время.' : 'Выберите услугу, чтобы увидеть свободное время.'}
              </p>
            )}
            {slotState.status === 'loading' && <p className="text-sm text-muted-foreground">Проверяем свободное время…</p>}
            {slotState.status === 'error' && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-destructive">Не удалось проверить свободное время.</p>
                <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((k) => k + 1)}>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Повторить
                </Button>
              </div>
            )}
            {slotState.status === 'ready' && slots.length === 0 && (
              <p className="text-sm text-muted-foreground">На выбранную дату свободного времени нет.</p>
            )}
            {slotState.status === 'ready' && slots.length > 0 && (
              <div role="group" aria-labelledby={labelId} className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                {slots.map((slot) => {
                  const selected = selectedSlot?.localStart === slot.localStart
                  return (
                    <Button
                      key={slot.localStart}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      aria-pressed={selected}
                      aria-label={`${slot.localStart}–${slot.localEnd}`}
                      title={`${slot.localStart}–${slot.localEnd}`}
                      className="w-full px-0 tabular-nums"
                      onClick={() => {
                        pinnedKeyRef.current = null
                        onChange({ startTime: slot.localStart, endTime: slot.localEnd })
                      }}
                    >
                      {slot.localStart}
                    </Button>
                  )
                })}
              </div>
            )}
            {hasTime && (
              <p className="text-sm">
                {selectedSlot ? 'Выбрано' : 'Текущее время'}:{' '}
                <span className="font-medium tabular-nums">
                  {value.startTime}–{value.endTime}
                </span>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-start`}>Начало</Label>
                <Input id={`${idPrefix}-start`} type="time" required value={value.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-end`}>Окончание</Label>
                <Input id={`${idPrefix}-end`} type="time" required value={value.endTime} onChange={(e) => onChange({ endTime: e.target.value })} />
              </div>
            </div>
            <div aria-live="polite">
              {check.status === 'idle' && <p className="text-sm text-muted-foreground">Укажите начало и окончание — сервер проверит время.</p>}
              {check.status === 'loading' && <p className="text-sm text-muted-foreground">Проверяем время…</p>}
              {check.status === 'ok' && <p className="text-sm text-green-600">Время свободно.</p>}
              {check.status === 'bad' &&
                check.messages.map((m) => (
                  <p key={m} className="text-sm text-destructive">
                    {m}
                  </p>
                ))}
              {check.status === 'error' && <p className="text-sm text-destructive">Не удалось проверить время.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
