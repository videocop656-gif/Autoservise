import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, CheckCircle2, Circle, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'
import { AppointmentTimeField } from '../appointments/AppointmentTimeField'
import type { AppointmentTime } from '../appointments/availability'
import { APPOINTMENT_STATUS_LABELS, REQUEST_STATUS_LABELS } from './shared'
import {
  type RequestBookingDto,
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
} from './booking'

// ---------------------------------------------------------------------------
// Prompt 56 — «Запись» from a CustomerRequest: readiness → free slots →
// explicit «Подтвердить запись». One component for Request Detail (the full
// surface) and Conversation Detail (compact), so there is one way to turn a
// request into an appointment.
//
//   State and readiness: GET /api/customer-requests/:id/booking (server-side,
//     from the persisted request — never from an AI proposal).
//   Slots: the Prompt 51 AppointmentTimeField (same endpoint and grid as
//     /appointments), slots only; the customer's wished time is highlighted,
//     never pre-selected or treated as reserved.
//   Selecting a slot writes nothing. Only «Подтвердить запись» posts
//     { startAt, expectedRequestUpdatedAt }; the server books the request's own
//     customer/vehicle/service through the canonical appointment service.
// Nothing is sent to the customer.
// ---------------------------------------------------------------------------

export interface RequestBookingSectionProps {
  requestId: string
  canManage: boolean
  /** Conversation Detail: smaller heading, no outer card. */
  compact?: boolean
  /** Parent-held confirmation of the last booking (the parent reloads, which may remount this section). */
  notice?: string | null
  onBooked?: (notice: string) => void
}

const EMPTY_TIME: AppointmentTime = { date: '', startTime: '', endTime: '' }

export function RequestBookingSection({ requestId, canManage, compact = false, notice = null, onBooked }: RequestBookingSectionProps) {
  const [booking, setBooking] = useState<RequestBookingDto | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadKey, setLoadKey] = useState(0)
  const [picking, setPicking] = useState(false)
  const [time, setTime] = useState<AppointmentTime>(EMPTY_TIME)
  const [slotReloadKey, setSlotReloadKey] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const confirmingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [localNotice, setLocalNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState((s) => (s === 'ready' ? s : 'loading'))
    apiFetch<{ booking: RequestBookingDto }>(`/api/customer-requests/${requestId}/booking`).then(
      ({ booking }) => {
        if (cancelled) return
        setBooking(booking)
        setLoadState('ready')
      },
      () => {
        if (!cancelled) setLoadState('error')
      }
    )
    return () => {
      cancelled = true
    }
  }, [requestId, loadKey])

  useEffect(() => {
    setPicking(false)
    setTime(EMPTY_TIME)
    setError(null)
    setLocalNotice(null)
  }, [requestId])

  function openPicker() {
    if (!booking) return
    const today = utcToZonedParts(new Date(), booking.timezone).dateStr
    setTime({ ...EMPTY_TIME, date: initialBookingDate(booking.preference, today) })
    setError(null)
    setPicking(true)
  }

  async function confirm() {
    if (!booking || !time.date || !time.startTime || confirmingRef.current) return
    confirmingRef.current = true
    setConfirming(true)
    setError(null)
    try {
      const startAt = zonedTimeToUtc(time.date, time.startTime, booking.timezone).toISOString()
      const result = await apiFetch<{ booking: RequestBookingDto; created: boolean }>(`/api/customer-requests/${requestId}/booking`, {
        method: 'POST',
        body: JSON.stringify({ startAt, expectedRequestUpdatedAt: booking.requestUpdatedAt }),
      })
      const text = bookedNotice(result.created, result.booking)
      setBooking(result.booking)
      setPicking(false)
      setTime(EMPTY_TIME)
      setLocalNotice(text)
      onBooked?.(text)
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined
      setError(err instanceof ApiClientError ? confirmErrorMessage(code, err.message) : CONFIRM_FAILED)
      if (isSlotGoneCode(code)) {
        // The time is no longer bookable: drop it and show fresh slots — never pick another one.
        setTime((t) => ({ ...t, startTime: '', endTime: '' }))
        setSlotReloadKey((k) => k + 1)
      } else if (isRequestChangedCode(code)) {
        setPicking(false)
        setTime(EMPTY_TIME)
        setLoadKey((k) => k + 1)
      }
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }

  const shownNotice = notice ?? localNotice
  const heading = compact ? (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Запись</h3>
  ) : (
    <h3 className="flex items-center gap-1.5 text-sm font-semibold">
      <CalendarCheck className="h-4 w-4 text-muted-foreground" />
      Запись
    </h3>
  )

  const body = (() => {
    if (loadState === 'loading' && !booking) return <p className="text-sm text-muted-foreground">Загрузка…</p>
    if (loadState === 'error' || !booking) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-destructive">Не удалось загрузить данные записи.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setLoadKey((k) => k + 1)}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Повторить
          </Button>
        </div>
      )
    }

    if (booking.state === 'booked' && booking.appointment) {
      const a = booking.appointment
      return (
        <div className="space-y-2 text-sm" data-testid="booking-booked">
          {shownNotice && (
            <p className="flex items-center gap-1 text-green-600" role="status">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {shownNotice}
            </p>
          )}
          <div className="flex items-start justify-between gap-2 rounded-md border border-border p-2">
            <span className="min-w-0">
              <span className="block font-medium tabular-nums">
                {bookedLine(a)}–{a.localEnd}
              </span>
              {(a.vehicleLabel || a.serviceName) && (
                <span className="block break-words text-muted-foreground">{[a.vehicleLabel, a.serviceName].filter(Boolean).join(' · ')}</span>
              )}
            </span>
            <Badge variant="default" className="shrink-0">
              {APPOINTMENT_STATUS_LABELS[a.status]}
            </Badge>
          </div>
          <Link to={`/appointments?open=${a.id}`} className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
            Открыть запись
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <p className="text-xs text-muted-foreground">Статус заявки: {REQUEST_STATUS_LABELS[booking.requestStatus]}</p>
        </div>
      )
    }

    if (booking.state === 'inconsistent') {
      return (
        <p className="flex items-start gap-1 text-sm text-amber-500" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Заявка отмечена как преобразованная, но связанная запись не найдена. Новая запись не создаётся — проверьте заявку.
        </p>
      )
    }

    if (booking.state === 'closed') {
      return <p className="text-sm text-muted-foreground">Заявка закрыта ({REQUEST_STATUS_LABELS[booking.requestStatus]}) — запись по ней не создаётся.</p>
    }

    const pref = preferenceText(booking.preference)
    const rows: { label: string; value: string | null; ok: boolean }[] = [
      { label: 'Клиент', value: booking.customer.name, ok: booking.customer.isActive },
      { label: 'Автомобиль', value: booking.vehicle?.label ?? null, ok: !!booking.vehicle?.isActive },
      { label: 'Услуга', value: booking.service?.name ?? null, ok: !!booking.service?.isActive },
    ]
    const ready = booking.state === 'ready'
    const timeHint = preferenceTimeText(booking.preference)

    return (
      <div className="space-y-3 text-sm">
        <div aria-label="Готовность к записи" className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Готовность к записи</span>
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-start gap-1.5">
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                <span className="min-w-0">
                  <span className="text-muted-foreground">{r.label}: </span>
                  <span className="break-words">{r.value ?? 'не указан' + (r.label === 'Услуга' ? 'а' : '')}</span>
                  {r.value && !r.ok && <span className="text-amber-500"> (неактивен{r.label === 'Услуга' ? 'а' : ''})</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Пожелание клиента: {pref ?? 'не указано'}
            {pref ? ' — это не бронь, время выбирается ниже.' : ''}
          </p>
        </div>

        {!ready && (
          <div className="space-y-1">
            <p className="text-amber-500">{missingText(booking.missing)}.</p>
            <p className="text-xs text-muted-foreground">
              {compact ? 'Дополните обращение через «Разбор обращения» или в карточке заявки.' : 'Дополните заявку кнопкой «Редактировать».'}
            </p>
          </div>
        )}

        {ready && canManage && !picking && (
          <div className="space-y-1">
            {shownNotice && <p className="text-green-600">{shownNotice}</p>}
            <Button type="button" size="sm" variant="outline" onClick={openPicker}>
              <CalendarCheck className="mr-1 h-4 w-4" />
              Подобрать время
            </Button>
          </div>
        )}
        {ready && !canManage && <p className="text-muted-foreground">Записи пока нет.</p>}

        {ready && canManage && picking && booking.vehicle && booking.service && (
          <div className="space-y-3 rounded-md border border-border p-3" data-testid="booking-picker">
            <AppointmentTimeField
              idPrefix={compact ? 'conv-booking' : 'request-booking'}
              timezone={booking.timezone}
              serviceId={booking.service.id}
              vehicleId={booking.vehicle.id}
              value={time}
              onChange={(patch) => {
                setError(null)
                setTime((t) => ({ ...t, ...patch }))
              }}
              reloadKey={slotReloadKey}
              allowManual={false}
              narrow={compact}
              isPreferred={(slot) => isPreferredSlot(slot, booking.preference)}
              preferenceHint={timeHint ? `Выделено время по пожеланию клиента (${timeHint}). Остальное свободное время тоже доступно.` : null}
            />

            {time.date && time.startTime && (
              <div className="space-y-2 rounded-md bg-muted/40 p-3" aria-label="Проверьте запись" data-testid="booking-summary">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Проверьте запись</span>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Клиент</dt>
                  <dd className="break-words">{booking.customer.name}</dd>
                  <dt className="text-muted-foreground">Автомобиль</dt>
                  <dd className="break-words">{booking.vehicle.label}</dd>
                  <dt className="text-muted-foreground">Услуга</dt>
                  <dd className="break-words">{booking.service.name}</dd>
                  <dt className="text-muted-foreground">Дата</dt>
                  <dd>{formatBookingDate(time.date)}</dd>
                  <dt className="text-muted-foreground">Время</dt>
                  <dd className="tabular-nums">
                    {time.startTime}–{time.endTime}
                  </dd>
                  <dt className="text-muted-foreground">Длительность</dt>
                  <dd>{durationText(booking.service.durationMinutes)}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {booking.convertsRequest
                    ? 'Заявка будет отмечена как «Преобразована».'
                    : `Статус заявки («${REQUEST_STATUS_LABELS[booking.requestStatus]}») не изменится — запись будет связана с заявкой.`}{' '}
                  Клиенту ничего не отправляется.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void confirm()} disabled={confirming || !time.startTime} aria-busy={confirming}>
                {confirming ? 'Создание записи…' : 'Подтвердить запись'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={confirming}
                onClick={() => {
                  setPicking(false)
                  setTime(EMPTY_TIME)
                  setError(null)
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  })()

  return (
    <section data-testid="request-booking" className={compact ? 'space-y-2' : 'space-y-2 rounded-md border border-border p-3'}>
      {heading}
      {body}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
