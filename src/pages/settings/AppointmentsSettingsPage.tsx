import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { PageHeader } from '../../components/layout/PageHeader'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'

type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'

interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
  endAt: string
  status: AppointmentStatus
  notes: string | null
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
}

interface VehicleDto {
  id: string
  customerId: string
  make: string
  model: string
  licensePlate: string | null
}

interface ServiceDto {
  id: string
  name: string
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface FormState {
  customerId: string
  vehicleId: string
  serviceId: string
  date: string
  startTime: string
  endTime: string
  notes: string
  status: AppointmentStatus
}

const EMPTY_FORM: FormState = {
  customerId: '',
  vehicleId: '',
  serviceId: '',
  date: '',
  startTime: '',
  endTime: '',
  notes: '',
  status: 'SCHEDULED',
}

const STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
}

function formatDuration(startAt: string, endAt: string): string {
  const minutes = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} min`
  if (mins === 0) return `${hours} h`
  return `${hours} h ${mins} min`
}

export default function AppointmentsSettingsPage() {
  const { business } = useAuth()
  const timezone = business?.timezone ?? 'UTC'

  const [data, setData] = useState<Paginated<AppointmentDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [services, setServices] = useState<ServiceDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('')
  const [includeCancelled, setIncludeCancelled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  function customerLabel(id: string): string {
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : id
  }

  function vehicleLabel(id: string): string {
    const v = vehicles.find((x) => x.id === id)
    return v ? `${v.make} ${v.model}${v.licensePlate ? ` (${v.licensePlate})` : ''}` : id
  }

  function serviceLabel(id: string): string {
    const s = services.find((x) => x.id === id)
    return s ? s.name : id
  }

  async function loadReferenceData() {
    try {
      const [customersResult, vehiclesResult, servicesResult] = await Promise.all([
        apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100'),
        apiFetch<Paginated<VehicleDto>>('/api/vehicles?pageSize=100'),
        apiFetch<{ services: ServiceDto[] }>('/api/services'),
      ])
      setCustomers(customersResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
    } catch {
      // Non-fatal: the appointments list still works, just shows raw ids as a fallback.
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
  }, [])

  useEffect(() => {
    void loadAppointments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, includeCancelled])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, includeCancelled])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(appt: AppointmentDto) {
    const start = utcToZonedParts(new Date(appt.startAt), timezone)
    const end = utcToZonedParts(new Date(appt.endAt), timezone)
    setEditingId(appt.id)
    setForm({
      customerId: appt.customerId,
      vehicleId: appt.vehicleId,
      serviceId: appt.serviceId,
      date: start.dateStr,
      startTime: start.timeStr,
      endTime: end.timeStr,
      notes: appt.notes ?? '',
      status: appt.status,
    })
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
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

      if (editingId) {
        await apiFetch(`/api/appointments/${editingId}`, {
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
      } else {
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
      }
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

  async function handleQuickStatusChange(appt: AppointmentDto, status: AppointmentStatus) {
    try {
      await apiFetch(`/api/appointments/${appt.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadAppointments()
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader title="Записи" subtitle="Appointments and service schedule" />
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Записи на обслуживание</CardTitle>
              <CardDescription>Часовой пояс автосервиса: {timezone}.</CardDescription>
            </div>
            <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0 || services.length === 0}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все статусы</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} />
                Показать отменённые
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Записей пока нет.</p>}

            {data?.items.map((appt) => {
              const local = utcToZonedParts(new Date(appt.startAt), timezone)
              return (
                <div key={appt.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {local.dateStr} {local.timeStr} · {formatDuration(appt.startAt, appt.endAt)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {customerLabel(appt.customerId)} · {vehicleLabel(appt.vehicleId)} · {serviceLabel(appt.serviceId)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={appt.status}
                      onChange={(e) => handleQuickStatusChange(appt, e.target.value as AppointmentStatus)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(appt)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? 'Редактировать запись' : 'Новая запись'}</CardTitle>
              <CardDescription>Время указывается в часовом поясе автосервиса ({timezone}).</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="appt-customer">Customer</Label>
                    <select
                      id="appt-customer"
                      required
                      value={form.customerId}
                      onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '' })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="" disabled>
                        Select a customer...
                      </option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="appt-vehicle">Vehicle</Label>
                    <select
                      id="appt-vehicle"
                      required
                      value={form.vehicleId}
                      onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="" disabled>
                        Select a vehicle...
                      </option>
                      {customerVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.make} {v.model} {v.licensePlate ? `(${v.licensePlate})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="appt-service">Service</Label>
                  <select
                    id="appt-service"
                    required
                    value={form.serviceId}
                    onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="" disabled>
                      Select a service...
                    </option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="appt-date">Date</Label>
                    <Input
                      id="appt-date"
                      type="date"
                      required
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="appt-start">Start time</Label>
                    <Input
                      id="appt-start"
                      type="time"
                      required
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="appt-end">End time</Label>
                    <Input
                      id="appt-end"
                      type="time"
                      required
                      value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                    />
                  </div>
                </div>

                {editingId && (
                  <div className="space-y-2">
                    <Label htmlFor="appt-status">Status</Label>
                    <select
                      id="appt-status"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as AppointmentStatus })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="appt-notes">Notes</Label>
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
                    {saving ? 'Сохранение...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeForm}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
    </PageContainer>
  )
}
