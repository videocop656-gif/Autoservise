import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, Plus, Archive, ArchiveRestore } from 'lucide-react'
import Nav from '../../components/Nav'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'

interface ServiceRecordDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  appointmentId: string | null
  performedAt: string
  mileage: number | null
  totalPrice: string
  currency: string
  workDescription: string
  partsDescription: string | null
  recommendations: string | null
  notes: string | null
  isArchived: boolean
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
  date: string
  time: string
  mileage: string
  totalPrice: string
  workDescription: string
  partsDescription: string
  recommendations: string
  notes: string
}

const EMPTY_FORM: FormState = {
  customerId: '',
  vehicleId: '',
  serviceId: '',
  appointmentId: '',
  date: '',
  time: '',
  mileage: '',
  totalPrice: '',
  workDescription: '',
  partsDescription: '',
  recommendations: '',
  notes: '',
}

export default function ServiceHistorySettingsPage() {
  const { business } = useAuth()
  const timezone = business?.timezone ?? 'UTC'
  const [searchParams, setSearchParams] = useSearchParams()

  const [data, setData] = useState<Paginated<ServiceRecordDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [services, setServices] = useState<ServiceDto[]>([])
  const [appointments, setAppointments] = useState<AppointmentDto[]>([])
  const [page, setPage] = useState(1)
  const vehicleFilter = searchParams.get('vehicleId') ?? ''
  const [customerFilter, setCustomerFilter] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
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
      // Non-fatal: the history list still works, just shows raw ids as a fallback.
    }
  }

  async function loadRecords() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (vehicleFilter) params.set('vehicleId', vehicleFilter)
      if (customerFilter) params.set('customerId', customerFilter)
      if (includeArchived) params.set('includeArchived', 'true')
      const result = await apiFetch<Paginated<ServiceRecordDto>>(`/api/service-history?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить историю обслуживания.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [])

  useEffect(() => {
    void loadRecords()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, vehicleFilter, customerFilter, includeArchived])

  useEffect(() => {
    setPage(1)
  }, [vehicleFilter, customerFilter, includeArchived])

  function openCreateForm() {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, vehicleId: vehicleFilter || '' })
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(record: ServiceRecordDto) {
    const local = utcToZonedParts(new Date(record.performedAt), timezone)
    setEditingId(record.id)
    setForm({
      customerId: record.customerId,
      vehicleId: record.vehicleId,
      serviceId: record.serviceId,
      appointmentId: record.appointmentId ?? '',
      date: local.dateStr,
      time: local.timeStr,
      mileage: record.mileage != null ? String(record.mileage) : '',
      totalPrice: record.totalPrice,
      workDescription: record.workDescription,
      partsDescription: record.partsDescription ?? '',
      recommendations: record.recommendations ?? '',
      notes: record.notes ?? '',
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
      const performedAt = zonedTimeToUtc(form.date, form.time, timezone).toISOString()
      const payload = {
        customerId: form.customerId,
        vehicleId: form.vehicleId,
        serviceId: form.serviceId,
        appointmentId: form.appointmentId === '' ? null : form.appointmentId,
        performedAt,
        mileage: form.mileage === '' ? null : Number(form.mileage),
        totalPrice: Number(form.totalPrice),
        workDescription: form.workDescription,
        partsDescription: form.partsDescription === '' ? null : form.partsDescription,
        recommendations: form.recommendations === '' ? null : form.recommendations,
        notes: form.notes === '' ? null : form.notes,
      }

      if (editingId) {
        await apiFetch(`/api/service-history/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/service-history', { method: 'POST', body: JSON.stringify(payload) })
      }
      closeForm()
      await loadRecords()
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

  async function handleArchiveToggle(record: ServiceRecordDto) {
    try {
      await apiFetch(`/api/service-history/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: !record.isArchived }),
      })
      await loadRecords()
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус архива.')
    }
  }

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)
  const matchingAppointments = appointments.filter(
    (a) => a.customerId === form.customerId && a.vehicleId === form.vehicleId && a.serviceId === form.serviceId
  )
  const filterVehicle = vehicles.find((v) => v.id === vehicleFilter)

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>История обслуживания</CardTitle>
              <CardDescription>
                {filterVehicle
                  ? `${filterVehicle.make} ${filterVehicle.model}${filterVehicle.licensePlate ? ` (${filterVehicle.licensePlate})` : ''} · ${customerLabel(filterVehicle.customerId)}`
                  : `Часовой пояс автосервиса: ${timezone}.`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {vehicleFilter && (
                <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>
                  Сбросить фильтр
                </Button>
              )}
              <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0 || services.length === 0}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все клиенты</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
                Показать архивные
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Записей пока нет.</p>}

            {data?.items.map((record) => {
              const local = utcToZonedParts(new Date(record.performedAt), timezone)
              return (
                <div key={record.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      {local.dateStr} · {serviceLabel(record.serviceId)}
                      {record.isArchived && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">архив</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {customerLabel(record.customerId)} · {vehicleLabel(record.vehicleId)}
                      {record.mileage != null ? ` · ${record.mileage} км` : ''} · {record.totalPrice} {record.currency}
                    </p>
                    <p className="line-clamp-1 text-sm text-muted-foreground">{record.workDescription}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(record)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleArchiveToggle(record)}>
                      {record.isArchived ? (
                        <>
                          <ArchiveRestore className="mr-1 h-4 w-4" />
                          Restore
                        </>
                      ) : (
                        <>
                          <Archive className="mr-1 h-4 w-4" />
                          Archive
                        </>
                      )}
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
              <CardTitle>{editingId ? 'Редактировать запись' : 'Новая запись обслуживания'}</CardTitle>
              <CardDescription>Дата указывается в часовом поясе автосервиса ({timezone}).</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sr-customer">Customer</Label>
                    <select
                      id="sr-customer"
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
                    <Label htmlFor="sr-vehicle">Vehicle</Label>
                    <select
                      id="sr-vehicle"
                      required
                      value={form.vehicleId}
                      onChange={(e) => setForm({ ...form, vehicleId: e.target.value, appointmentId: '' })}
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sr-service">Service</Label>
                    <select
                      id="sr-service"
                      required
                      value={form.serviceId}
                      onChange={(e) => setForm({ ...form, serviceId: e.target.value, appointmentId: '' })}
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
                  <div className="space-y-2">
                    <Label htmlFor="sr-appointment">Appointment (optional)</Label>
                    <select
                      id="sr-appointment"
                      value={form.appointmentId}
                      onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">None (historical record)</option>
                      {matchingAppointments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {utcToZonedParts(new Date(a.startAt), timezone).dateStr}{' '}
                          {utcToZonedParts(new Date(a.startAt), timezone).timeStr}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sr-date">Date performed</Label>
                    <Input
                      id="sr-date"
                      type="date"
                      required
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sr-time">Time</Label>
                    <Input
                      id="sr-time"
                      type="time"
                      required
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sr-mileage">Mileage (km)</Label>
                    <Input
                      id="sr-mileage"
                      type="number"
                      min="0"
                      value={form.mileage}
                      onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                    />
                    {fieldErrors.mileage && <p className="text-sm text-destructive">{fieldErrors.mileage[0]}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sr-price">Total price</Label>
                  <Input
                    id="sr-price"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.totalPrice}
                    onChange={(e) => setForm({ ...form, totalPrice: e.target.value })}
                  />
                  {fieldErrors.totalPrice && <p className="text-sm text-destructive">{fieldErrors.totalPrice[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sr-work">Work description</Label>
                  <Textarea
                    id="sr-work"
                    required
                    value={form.workDescription}
                    onChange={(e) => setForm({ ...form, workDescription: e.target.value })}
                  />
                  {fieldErrors.workDescription && <p className="text-sm text-destructive">{fieldErrors.workDescription[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sr-parts">Parts / materials used</Label>
                  <Textarea
                    id="sr-parts"
                    value={form.partsDescription}
                    onChange={(e) => setForm({ ...form, partsDescription: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sr-recommendations">Recommendations</Label>
                  <Textarea
                    id="sr-recommendations"
                    value={form.recommendations}
                    onChange={(e) => setForm({ ...form, recommendations: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sr-notes">Notes</Label>
                  <Textarea id="sr-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
