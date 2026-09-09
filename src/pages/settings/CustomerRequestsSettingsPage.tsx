import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'

type CustomerRequestSource = 'PHONE' | 'WEBSITE' | 'MANUAL' | 'OTHER'
type CustomerRequestStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'QUALIFIED' | 'CONVERTED' | 'CLOSED' | 'CANCELLED'

interface StatusHistoryDto {
  fromStatus: CustomerRequestStatus | null
  toStatus: CustomerRequestStatus
  changedByUserId: string | null
  changedByUserName: string | null
  createdAt: string
}

interface CustomerRequestDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  appointmentId: string | null
  source: CustomerRequestSource
  status: CustomerRequestStatus
  subject: string
  description: string | null
  requestedDate: string | null
  requestedTimeFrom: string | null
  requestedTimeTo: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  statusHistory?: StatusHistoryDto[]
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
  isActive: boolean
}
interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
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
  appointmentId: string
  subject: string
  description: string
  requestedDate: string
  requestedTimeFrom: string
  requestedTimeTo: string
  source: CustomerRequestSource
  status: CustomerRequestStatus
  notes: string
}

const EMPTY_FORM: FormState = {
  customerId: '',
  vehicleId: '',
  serviceId: '',
  appointmentId: '',
  subject: '',
  description: '',
  requestedDate: '',
  requestedTimeFrom: '',
  requestedTimeTo: '',
  source: 'MANUAL',
  status: 'NEW',
  notes: '',
}

const STATUSES: CustomerRequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'QUALIFIED', 'CONVERTED', 'CLOSED', 'CANCELLED']
const SOURCES: CustomerRequestSource[] = ['PHONE', 'WEBSITE', 'MANUAL', 'OTHER']

const STATUS_LABELS: Record<CustomerRequestStatus, string> = {
  NEW: 'Новый',
  IN_PROGRESS: 'В работе',
  WAITING_CUSTOMER: 'Ждём клиента',
  QUALIFIED: 'Квалифицирован',
  CONVERTED: 'Конвертирован',
  CLOSED: 'Закрыт',
  CANCELLED: 'Отменён',
}

export default function CustomerRequestsSettingsPage() {
  const { user, business } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'
  const timezone = business?.timezone ?? 'UTC'

  const [data, setData] = useState<Paginated<CustomerRequestDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [services, setServices] = useState<ServiceDto[]>([])
  const [appointments, setAppointments] = useState<AppointmentDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<CustomerRequestStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<CustomerRequestSource | ''>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [editingHistory, setEditingHistory] = useState<StatusHistoryDto[]>([])

  function customerLabel(id: string | null): string {
    if (!id) return '—'
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : id
  }
  function vehicleLabel(id: string | null): string {
    if (!id) return '—'
    const v = vehicles.find((x) => x.id === id)
    return v ? `${v.make} ${v.model}${v.licensePlate ? ` (${v.licensePlate})` : ''}` : id
  }
  function serviceLabel(id: string | null): string {
    if (!id) return '—'
    return services.find((x) => x.id === id)?.name ?? id
  }

  async function loadReferenceData() {
    try {
      const [customersResult, vehiclesResult, servicesResult, appointmentsResult] = await Promise.all([
        apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<VehicleDto>>('/api/vehicles?pageSize=100&includeInactive=true'),
        apiFetch<{ services: ServiceDto[] }>('/api/services?activeOnly=false'),
        apiFetch<Paginated<AppointmentDto>>('/api/appointments?pageSize=100&includeCancelled=true'),
      ])
      setCustomers(customersResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
      setAppointments(appointmentsResult.items)
    } catch {
      // Non-fatal: the request list still works, just shows raw ids as a fallback.
    }
  }

  async function loadRequests() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      if (search.trim()) params.set('search', search.trim())
      const result = await apiFetch<Paginated<CustomerRequestDto>>(`/api/customer-requests?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить обращения.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [])

  useEffect(() => {
    void loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sourceFilter, search])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, sourceFilter, search])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setEditingHistory([])
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  async function openEditForm(request: CustomerRequestDto) {
    setEditingId(request.id)
    setForm({
      customerId: request.customerId,
      vehicleId: request.vehicleId ?? '',
      serviceId: request.serviceId ?? '',
      appointmentId: request.appointmentId ?? '',
      subject: request.subject,
      description: request.description ?? '',
      requestedDate: request.requestedDate ? utcToZonedParts(new Date(request.requestedDate), timezone).dateStr : '',
      requestedTimeFrom: request.requestedTimeFrom ?? '',
      requestedTimeTo: request.requestedTimeTo ?? '',
      source: request.source,
      status: request.status,
      notes: request.notes ?? '',
    })
    setEditingHistory([])
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)

    try {
      const detail = await apiFetch<{ customerRequest: CustomerRequestDto }>(`/api/customer-requests/${request.id}`)
      setEditingHistory(detail.customerRequest.statusHistory ?? [])
    } catch {
      // Non-fatal: the form still works without the history trail.
    }
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setEditingHistory([])
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSaving(true)

    try {
      const requestedDate = form.requestedDate ? zonedTimeToUtc(form.requestedDate, '00:00', timezone).toISOString() : null

      if (editingId) {
        await apiFetch(`/api/customer-requests/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            customerId: form.customerId,
            vehicleId: form.vehicleId === '' ? null : form.vehicleId,
            serviceId: form.serviceId === '' ? null : form.serviceId,
            appointmentId: form.appointmentId === '' ? null : form.appointmentId,
            subject: form.subject,
            description: form.description === '' ? null : form.description,
            requestedDate,
            requestedTimeFrom: form.requestedTimeFrom === '' ? null : form.requestedTimeFrom,
            requestedTimeTo: form.requestedTimeTo === '' ? null : form.requestedTimeTo,
            source: form.source,
            status: form.status,
            notes: form.notes === '' ? null : form.notes,
          }),
        })
      } else {
        await apiFetch('/api/customer-requests', {
          method: 'POST',
          body: JSON.stringify({
            customerId: form.customerId,
            vehicleId: form.vehicleId === '' ? null : form.vehicleId,
            serviceId: form.serviceId === '' ? null : form.serviceId,
            appointmentId: form.appointmentId === '' ? null : form.appointmentId,
            subject: form.subject,
            description: form.description === '' ? null : form.description,
            requestedDate,
            requestedTimeFrom: form.requestedTimeFrom === '' ? null : form.requestedTimeFrom,
            requestedTimeTo: form.requestedTimeTo === '' ? null : form.requestedTimeTo,
            source: form.source,
            notes: form.notes === '' ? null : form.notes,
          }),
        })
      }
      closeForm()
      await loadRequests()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить обращение.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickStatusChange(request: CustomerRequestDto, status: CustomerRequestStatus) {
    try {
      await apiFetch(`/api/customer-requests/${request.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadRequests()
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)
  // Only active services are offered for a NEW selection, but a request
  // already pointing at a since-deactivated service must keep showing it
  // (otherwise it would silently vanish from its own edit form) — historical
  // editing must never be blocked by a relation becoming inactive (spec §14).
  const selectableServices = services.filter((s) => s.isActive || s.id === form.serviceId)
  const matchingAppointments = appointments.filter(
    (a) =>
      a.customerId === form.customerId &&
      (form.vehicleId === '' || a.vehicleId === form.vehicleId) &&
      (form.serviceId === '' || a.serviceId === form.serviceId)
  )

  return (
    <PageContainer className="max-w-4xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Обращения клиентов</CardTitle>
              <CardDescription>Структурированные обращения — до записи на обслуживание.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Поиск по теме или описанию..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-56"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as CustomerRequestStatus | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все статусы</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as CustomerRequestSource | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все источники</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Обращений пока нет.</p>}

            {data?.items.map((request) => (
              <div key={request.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">{request.subject}</div>
                  <p className="text-sm text-muted-foreground">
                    {customerLabel(request.customerId)} · {vehicleLabel(request.vehicleId)} · {serviceLabel(request.serviceId)} ·{' '}
                    {request.source}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {request.requestedDate
                      ? `Желаемая дата: ${utcToZonedParts(new Date(request.requestedDate), timezone).dateStr}`
                      : `Создано: ${new Date(request.createdAt).toLocaleDateString()}`}
                    {request.requestedTimeFrom ? ` ${request.requestedTimeFrom}` : ''}
                    {request.requestedTimeTo ? `–${request.requestedTimeTo}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <select
                      value={request.status}
                      onChange={(e) => handleQuickStatusChange(request, e.target.value as CustomerRequestStatus)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {STATUS_LABELS[request.status]}
                    </span>
                  )}
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(request)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {showForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? 'Редактировать обращение' : 'Новое обращение'}</CardTitle>
              <CardDescription>Желаемая дата указывается в часовом поясе автосервиса ({timezone}).</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cr-customer">Customer</Label>
                    <select
                      id="cr-customer"
                      required
                      value={form.customerId}
                      onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '', appointmentId: '' })}
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
                    <Label htmlFor="cr-vehicle">Vehicle (optional)</Label>
                    <select
                      id="cr-vehicle"
                      value={form.vehicleId}
                      onChange={(e) => setForm({ ...form, vehicleId: e.target.value, appointmentId: '' })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">None</option>
                      {customerVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.make} {v.model} {v.licensePlate ? `(${v.licensePlate})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cr-service">Service (optional)</Label>
                    <select
                      id="cr-service"
                      value={form.serviceId}
                      onChange={(e) => setForm({ ...form, serviceId: e.target.value, appointmentId: '' })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">None</option>
                      {selectableServices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {editingId && (
                    <div className="space-y-2">
                      <Label htmlFor="cr-appointment">Appointment (optional)</Label>
                      <select
                        id="cr-appointment"
                        value={form.appointmentId}
                        onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                      >
                        <option value="">None</option>
                        {matchingAppointments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {utcToZonedParts(new Date(a.startAt), timezone).dateStr}{' '}
                            {utcToZonedParts(new Date(a.startAt), timezone).timeStr}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cr-subject">Subject</Label>
                  <Input
                    id="cr-subject"
                    required
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                  {fieldErrors.subject && <p className="text-sm text-destructive">{fieldErrors.subject[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cr-description">Description</Label>
                  <Textarea
                    id="cr-description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cr-date">Requested date (optional)</Label>
                    <Input
                      id="cr-date"
                      type="date"
                      value={form.requestedDate}
                      onChange={(e) => setForm({ ...form, requestedDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cr-time-from">Time from (optional)</Label>
                    <Input
                      id="cr-time-from"
                      type="time"
                      value={form.requestedTimeFrom}
                      onChange={(e) => setForm({ ...form, requestedTimeFrom: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cr-time-to">Time to (optional)</Label>
                    <Input
                      id="cr-time-to"
                      type="time"
                      value={form.requestedTimeTo}
                      onChange={(e) => setForm({ ...form, requestedTimeTo: e.target.value })}
                    />
                  </div>
                </div>
                {fieldErrors.requestedTimeTo && <p className="text-sm text-destructive">{fieldErrors.requestedTimeTo[0]}</p>}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cr-source">Source</Label>
                    <select
                      id="cr-source"
                      value={form.source}
                      onChange={(e) => setForm({ ...form, source: e.target.value as CustomerRequestSource })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  {editingId && (
                    <div className="space-y-2">
                      <Label htmlFor="cr-status">Status</Label>
                      <select
                        id="cr-status"
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value as CustomerRequestStatus })}
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cr-notes">Notes</Label>
                  <Textarea id="cr-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>

                {formError && <p className="text-sm text-destructive">{formError}</p>}

                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Сохранение...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeForm}>
                    Cancel
                  </Button>
                </div>
              </form>

              {editingId && editingHistory.length > 0 && (
                <div className="mt-6 space-y-2 border-t pt-4">
                  <h3 className="text-sm font-medium">История статусов</h3>
                  {editingHistory.map((h, i) => (
                    <div key={i} className="text-sm text-muted-foreground">
                      {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : 'Создано: '}
                      {STATUS_LABELS[h.toStatus]} · {new Date(h.createdAt).toLocaleString()}
                      {h.changedByUserName ? ` · ${h.changedByUserName}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
    </PageContainer>
  )
}
