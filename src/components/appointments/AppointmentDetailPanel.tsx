import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, RefreshCw, User, Car, Wrench, ClipboardList, History, XCircle, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'
import {
  type AppointmentDto,
  type AppointmentStatus,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type CustomerRequestRefDto,
  type ServiceRecordDto,
  type Paginated,
  APPOINTMENT_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  APPOINTMENT_NEXT_STATUSES,
  isAppointmentTerminal,
  customerName,
  vehicleLabel,
  serviceName,
  formatDate,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 28 — Appointment Detail v1.
//
// Audit result (see Final Report): Appointment already has real, direct
// relations to Customer/Vehicle/Service (required FKs) and a real,
// backend-enforced status lifecycle (SCHEDULED -> CONFIRMED/IN_PROGRESS ->
// COMPLETED, with CANCELLED/NO_SHOW as alternate terminal exits at various
// points — audited from appointmentService.ts's own ALLOWED_TRANSITIONS).
// "Rescheduling" is just a time-field PATCH (re-validated against working
// hours/conflicts); "cancellation" is PATCH{status:CANCELLED}. No
// ServiceRecord is ever auto-created on COMPLETED — that link is manual
// and optional (ServiceRecord.appointmentId), confirmed by reading
// serviceRecordService.ts.
//
// Data sources:
//   Appointment itself   -> GET /api/appointments/:id (unchanged)
//   Customer/Vehicle/     -> resolved from the SAME reference lists the
//   Service                 parent list page already fetches once — zero
//                            extra requests, same pattern as every other
//                            Detail panel in this app.
//   Linked requests       -> GET /api/customer-requests?appointmentId=
//                            (the real reverse relation — confirmed via
//                            customerRequestService.ts's own filter)
//   Service history       -> GET /api/service-history?vehicleId= (the only
//                            filter that endpoint actually supports — it
//                            has no appointmentId filter) then filtered
//                            client-side to records whose own real
//                            appointmentId matches this appointment. One
//                            bulk request, not per-record.
// The requests lookup runs in parallel with the appointment fetch itself
// (it only needs the id from props, not the fetched appointment); the
// service-history lookup is a genuine second-phase dependency (it needs
// the appointment's vehicleId, only known once the appointment resolves).
// ---------------------------------------------------------------------------

interface EditFormState {
  customerId: string
  vehicleId: string
  serviceId: string
  date: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  notes: string
}

const STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']

export interface AppointmentDetailPanelProps {
  appointmentId: string
  canManage: boolean
  timezone: string
  customers: CustomerRefDto[]
  vehicles: VehicleRefDto[]
  services: ServiceRefDto[]
  onBack: () => void
  onChanged: () => void
}

export function AppointmentDetailPanel({
  appointmentId,
  canManage,
  timezone,
  customers,
  vehicles,
  services,
  onBack,
  onChanged,
}: AppointmentDetailPanelProps) {
  const navigate = useNavigate()

  const [appointment, setAppointment] = useState<AppointmentDto | null>(null)
  const [requests, setRequests] = useState<CustomerRequestRefDto[]>([])
  const [requestsError, setRequestsError] = useState(false)
  const [history, setHistory] = useState<ServiceRecordDto[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [appointmentResult, requestsResult] = await Promise.allSettled([
      apiFetch<{ appointment: AppointmentDto }>(`/api/appointments/${appointmentId}`),
      apiFetch<Paginated<CustomerRequestRefDto>>(`/api/customer-requests?appointmentId=${appointmentId}&pageSize=5`),
    ])

    setRequests(requestsResult.status === 'fulfilled' ? requestsResult.value.items : [])
    setRequestsError(requestsResult.status !== 'fulfilled')

    if (appointmentResult.status === 'fulfilled') {
      const loadedAppointment = appointmentResult.value.appointment
      setAppointment(loadedAppointment)
      try {
        const historyResult = await apiFetch<Paginated<ServiceRecordDto>>(`/api/service-history?vehicleId=${loadedAppointment.vehicleId}&pageSize=100`)
        setHistory(historyResult.items.filter((r) => r.appointmentId === appointmentId))
        setHistoryError(false)
      } catch {
        setHistory([])
        setHistoryError(true)
      }
    } else {
      setError('Не удалось загрузить запись.')
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  async function handleStatusChange(status: AppointmentStatus) {
    setStatusError(null)
    try {
      await apiFetch(`/api/appointments/${appointmentId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadAll()
      onChanged()
    } catch (err) {
      setStatusError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  function openEdit() {
    if (!appointment) return
    const start = utcToZonedParts(new Date(appointment.startAt), timezone)
    const end = utcToZonedParts(new Date(appointment.endAt), timezone)
    setForm({
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      serviceId: appointment.serviceId,
      date: start.dateStr,
      startTime: start.timeStr,
      endTime: end.timeStr,
      status: appointment.status,
      notes: appointment.notes ?? '',
    })
    setFormError(null)
    setFieldErrors({})
    setEditing(true)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setFormError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      const startAt = zonedTimeToUtc(form.date, form.startTime, timezone).toISOString()
      const endAt = zonedTimeToUtc(form.date, form.endTime, timezone).toISOString()
      await apiFetch(`/api/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          customerId: form.customerId,
          vehicleId: form.vehicleId,
          serviceId: form.serviceId,
          startAt,
          endAt,
          status: form.status,
          notes: form.notes === '' ? null : form.notes,
        }),
      })
      setEditing(false)
      await loadAll()
      onChanged()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить запись.')
      }
    } finally {
      setSaving(false)
    }
  }

  const customer = appointment ? customers.find((c) => c.id === appointment.customerId) : undefined
  const vehicle = appointment ? vehicles.find((v) => v.id === appointment.vehicleId) : undefined
  const service = appointment ? services.find((s) => s.id === appointment.serviceId) : undefined
  const customerVehicles = form ? vehicles.filter((v) => v.customerId === form.customerId) : []
  const isTerminal = appointment ? isAppointmentTerminal(appointment.status) : false

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Назад к записям
        </Button>
        {appointment && (
          <div className="flex flex-wrap items-center gap-2">
            {canManage && !isTerminal ? (
              <select
                value={appointment.status}
                onChange={(e) => handleStatusChange(e.target.value as AppointmentStatus)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Изменить статус записи"
              >
                <option value={appointment.status}>{APPOINTMENT_STATUS_LABELS[appointment.status]}</option>
                {APPOINTMENT_NEXT_STATUSES[appointment.status].map((s) => (
                  <option key={s} value={s}>
                    {APPOINTMENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <Badge variant="default">{APPOINTMENT_STATUS_LABELS[appointment.status]}</Badge>
            )}
            {canManage && !isTerminal && (
              <Button variant="outline" size="sm" onClick={() => handleStatusChange('CANCELLED')}>
                <XCircle className="mr-1 h-4 w-4" />
                Отменить
              </Button>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Pencil className="mr-1 h-4 w-4" />
                Редактировать
              </Button>
            )}
          </div>
        )}
      </div>
      {appointment && (
        <div className="border-b border-border px-4 py-3">
          <div className="text-lg font-semibold">
            {utcToZonedParts(new Date(appointment.startAt), timezone).dateStr}{' '}
            {utcToZonedParts(new Date(appointment.startAt), timezone).timeStr}–
            {utcToZonedParts(new Date(appointment.endAt), timezone).timeStr}
          </div>
          {appointment.notes && <p className="mt-1 text-sm text-muted-foreground">{appointment.notes}</p>}
          {statusError && <p className="mt-1 text-sm text-destructive">{statusError}</p>}
        </div>
      )}

      {/* Edit form */}
      {editing && form && (
        <div className="border-b border-border p-4">
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="appt-customer">Клиент</Label>
                <select
                  id="appt-customer"
                  required
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '' })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="appt-vehicle">Автомобиль</Label>
                <select
                  id="appt-vehicle"
                  required
                  value={form.vehicleId}
                  onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  {customerVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="appt-service">Услуга</Label>
              <select
                id="appt-service"
                required
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="appt-date">Дата</Label>
                <Input id="appt-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appt-start">Начало</Label>
                <Input id="appt-start" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="appt-end">Окончание</Label>
                <Input id="appt-end" type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="appt-status">Статус</Label>
              <select
                id="appt-status"
                value={form.status}
                disabled={appointment ? isAppointmentTerminal(appointment.status) : false}
                onChange={(e) => setForm({ ...form, status: e.target.value as AppointmentStatus })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {appointment && (
                  <>
                    <option value={appointment.status}>{APPOINTMENT_STATUS_LABELS[appointment.status]}</option>
                    {APPOINTMENT_NEXT_STATUSES[appointment.status].map((s) => (
                      <option key={s} value={s}>
                        {APPOINTMENT_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="appt-notes">Заметки</Label>
              <Textarea id="appt-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
            {Object.entries(fieldErrors).map(([field, messages]) => (
              <p key={field} className="text-sm text-destructive">
                {field}: {messages[0]}
              </p>
            ))}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2 p-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Повторить
          </Button>
        </div>
      )}

      {/* Body */}
      {!loading && !error && appointment && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="h-4 w-4 text-muted-foreground" />
              Клиент
            </h3>
            {customer ? (
              <button
                type="button"
                onClick={() => navigate(`/clients?open=${customer.id}`)}
                className="block w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <div className="font-medium">{customerName(customers, appointment.customerId)}</div>
                <div className="text-muted-foreground">
                  {customer.phone}
                  {customer.email ? ` · ${customer.email}` : ''}
                </div>
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">Клиент не определён</p>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Car className="h-4 w-4 text-muted-foreground" />
              Автомобиль
            </h3>
            {vehicle ? (
              <button
                type="button"
                onClick={() => navigate(`/vehicles?open=${vehicle.id}`)}
                className="block w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <div className="font-medium">{vehicleLabel(vehicle)}</div>
                {(vehicle.licensePlate || vehicle.vin) && (
                  <div className="text-muted-foreground">{[vehicle.licensePlate, vehicle.vin].filter(Boolean).join(' · ')}</div>
                )}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">Автомобиль не указан</p>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              Услуга
            </h3>
            {service ? <p className="text-sm">{serviceName(services, service.id)}</p> : <p className="text-sm text-muted-foreground">Услуга не указана</p>}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Заявка
            </h3>
            {requestsError && <p className="text-sm text-destructive">Не удалось загрузить заявки</p>}
            {!requestsError && requests.length === 0 && <p className="text-sm text-muted-foreground">Заявка не связана</p>}
            {requests.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => navigate(`/requests?open=${r.id}`)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <span className="truncate">{r.subject}</span>
                <Badge variant="default">{REQUEST_STATUS_LABELS[r.status]}</Badge>
              </button>
            ))}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="h-4 w-4 text-muted-foreground" />
                История обслуживания
              </h3>
              {/* Prompt 29 — completing an appointment does not create a
                  ServiceRecord automatically (audited: appointmentService.ts
                  never touches serviceRecordRepository). This link makes
                  the real, existing, manual next step ("log what was
                  actually done") one click away instead of a separate,
                  unguided trip to Settings, pre-filling the exact
                  customer/vehicle/service/appointment already known here —
                  not a new workflow, just existing-form pre-fill. */}
              {canManage && appointment.status === 'COMPLETED' && (
                <Link
                  to={`/settings/service-history?vehicleId=${appointment.vehicleId}&customerId=${appointment.customerId}&serviceId=${appointment.serviceId}&appointmentId=${appointment.id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                >
                  <Plus className="h-3 w-3" />
                  Добавить запись
                </Link>
              )}
            </div>
            {historyError && <p className="text-sm text-destructive">Не удалось загрузить историю обслуживания</p>}
            {!historyError && history.length === 0 && <p className="text-sm text-muted-foreground">Записей истории по этой записи нет</p>}
            {history.map((h) => (
              <div key={h.id} className="rounded-md border border-border p-2 text-sm">
                <div className="text-xs text-muted-foreground">{formatDate(h.performedAt)}</div>
                <div>{h.workDescription}</div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
