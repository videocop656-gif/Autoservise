import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { PageHeader } from '../../components/layout/PageHeader'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'
import { AppointmentDetailPanel } from '../../components/appointments/AppointmentDetailPanel'
import {
  type AppointmentDto,
  type AppointmentStatus,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type Paginated,
  APPOINTMENT_STATUS_LABELS,
  customerName,
  vehicleLabel,
  serviceName,
} from '../../components/appointments/shared'

// ---------------------------------------------------------------------------
// Prompt 28 — Appointment Detail v1, built on the existing
// GET/POST/PATCH /api/appointments endpoints (unchanged since Prompt 05).
// No DELETE by design — an appointment's lifecycle is status-only (use
// PATCH {status: "CANCELLED"}), confirmed by api/appointments/[id].ts's
// own comment.
//
// /appointments has been the canonical route since Prompt 19 ("Записи")
// — no route/navigation change needed this prompt, only the screen's own
// content: rows now open a real Detail (matching Conversations/Clients/
// Requests/Vehicles) instead of exposing inline edit/status controls.
//
// No search box exists here (none did before, and appointmentRepository
// has no search implementation at all — confirmed by audit — so none was
// added; see Final Report).
// ---------------------------------------------------------------------------

interface CreateFormState {
  customerId: string
  vehicleId: string
  serviceId: string
  date: string
  startTime: string
  endTime: string
  notes: string
}

const EMPTY_FORM: CreateFormState = { customerId: '', vehicleId: '', serviceId: '', date: '', startTime: '', endTime: '', notes: '' }

const STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']

export default function AppointmentsSettingsPage() {
  const { user, business } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'
  const timezone = business?.timezone ?? 'UTC'

  const [data, setData] = useState<Paginated<AppointmentDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerRefDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleRefDto[]>([])
  const [services, setServices] = useState<ServiceRefDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('')
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)

  // Cross-navigation from Client/Vehicle/Request Detail (/appointments?open=<id>)
  // — same mechanism as Prompts 23-26's own ?open= handling.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const toOpen = searchParams.get('open')
    if (toOpen) {
      setOpenId(toOpen)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadReferenceData() {
    try {
      const [customersResult, vehiclesResult, servicesResult] = await Promise.all([
        apiFetch<Paginated<CustomerRefDto>>('/api/customers?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<VehicleRefDto>>('/api/vehicles?pageSize=100&includeInactive=true'),
        apiFetch<{ services: ServiceRefDto[] }>('/api/services?activeOnly=false'),
      ])
      setCustomers(customersResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
    } catch {
      // Non-fatal: the appointments list/detail still work, just fall back to raw ids.
    }
  }

  async function loadAppointments() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (includeCancelled) params.set('includeCancelled', 'true')
      const result = await apiFetch<Paginated<AppointmentDto>>(`/api/appointments?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить записи.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void loadAppointments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, includeCancelled, refreshKey])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, includeCancelled])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function openDetail(id: string) {
    setOpenId(id)
  }

  function closeDetail() {
    setOpenId(null)
  }

  function handleDetailChanged() {
    void loadAppointments()
  }

  function openCreateForm() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      const startAt = zonedTimeToUtc(form.date, form.startTime, timezone).toISOString()
      const endAt = zonedTimeToUtc(form.date, form.endTime, timezone).toISOString()
      await apiFetch('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          vehicleId: form.vehicleId,
          serviceId: form.serviceId,
          startAt,
          endAt,
          notes: form.notes === '' ? null : form.notes,
        }),
      })
      closeForm()
      await loadAppointments()
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

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)

  // Appointment Detail v1 (Prompt 28) — same full-screen-swap pattern as
  // every other Detail screen in this app: no new route (/appointments
  // was already canonical since Prompt 19).
  if (openId) {
    return (
      <PageContainer className="max-w-5xl">
        <AppointmentDetailPanel
          appointmentId={openId}
          canManage={canManage}
          timezone={timezone}
          customers={customers}
          vehicles={vehicles}
          services={services}
          onBack={closeDetail}
          onChanged={handleDetailChanged}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader
        title="Записи"
        subtitle="Все записи на обслуживание в одном месте"
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0 || services.length === 0}>
              <Plus className="mr-1 h-4 w-4" />
              Новая запись
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | '')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по статусу"
            >
              <option value="">Все статусы</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {APPOINTMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} />
              Показать отменённые
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-md border border-border bg-muted/40" />
              ))}
            </div>
          )}

          {!loading && listError && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-border py-8 text-center">
              <p className="text-sm text-destructive">{listError}</p>
              <Button variant="outline" size="sm" onClick={retry}>
                <RefreshCw className="mr-1 h-4 w-4" />
                Повторить
              </Button>
            </div>
          )}

          {!loading && !listError && data?.items.length === 0 && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Записей пока нет</p>
            </div>
          )}

          {!loading &&
            !listError &&
            data?.items.map((appt) => {
              const local = utcToZonedParts(new Date(appt.startAt), timezone)
              const vehicle = vehicles.find((v) => v.id === appt.vehicleId)
              return (
                <button
                  key={appt.id}
                  type="button"
                  onClick={() => openDetail(appt.id)}
                  className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {local.dateStr} {local.timeStr}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {customerName(customers, appt.customerId)} · {vehicle ? vehicleLabel(vehicle) : '—'} · {serviceName(services, appt.serviceId) ?? '—'}
                    </p>
                  </div>
                  <Badge variant="default">{APPOINTMENT_STATUS_LABELS[appt.status]}</Badge>
                </button>
              )
            })}

          {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
        </CardContent>
      </Card>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Новая запись</h2>
            <p className="text-sm text-muted-foreground">Время указывается в часовом поясе автосервиса ({timezone}).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
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
                    <option value="" disabled>
                      Выберите клиента...
                    </option>
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
                    <option value="" disabled>
                      Выберите автомобиль...
                    </option>
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
                  <option value="" disabled>
                    Выберите услугу...
                  </option>
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
                <Button type="button" variant="outline" onClick={closeForm}>
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}
