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
import { zonedTimeToUtc } from '../../lib/businessTime'
import { RequestDetailPanel } from '../../components/requests/RequestDetailPanel'
import {
  type CustomerRequestDto,
  type CustomerRequestStatus,
  type CustomerRequestSource,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type Paginated,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  customerName,
  vehicleLabel,
  serviceName,
  formatActivity,
} from '../../components/requests/shared'

// ---------------------------------------------------------------------------
// Prompt 24 — Customer Requests v1, built on the existing
// GET/POST/PATCH /api/customer-requests endpoints (unchanged since
// Prompt 07). No DELETE exists by design (a request's lifecycle is
// status-only — see api/customer-requests/[id].ts's own comment) and none
// is added here.
//
// Canonical route: /requests (new — previously only reachable at
// /settings/customer-requests, which is not part of the primary nav).
// /settings/customer-requests now redirects here (see App.tsx), the same
// "single source of truth" pattern Prompt 19 established for Conversations/
// Clients/Appointments/Escalations/Channels.
// ---------------------------------------------------------------------------

interface AppointmentRefDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
}

interface CreateFormState {
  customerId: string
  vehicleId: string
  serviceId: string
  subject: string
  description: string
  requestedDate: string
  requestedTimeFrom: string
  requestedTimeTo: string
  source: CustomerRequestSource
}

const EMPTY_FORM: CreateFormState = {
  customerId: '',
  vehicleId: '',
  serviceId: '',
  subject: '',
  description: '',
  requestedDate: '',
  requestedTimeFrom: '',
  requestedTimeTo: '',
  source: 'MANUAL',
}

const STATUSES: CustomerRequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'QUALIFIED', 'CONVERTED', 'CLOSED', 'CANCELLED']
const SOURCES: CustomerRequestSource[] = ['PHONE', 'WEBSITE', 'MANUAL', 'OTHER']

/** 300ms debounce on the search box only — same convention as Conversations/Clients v1. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function CustomerRequestsSettingsPage() {
  const { user, business } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'
  const timezone = business?.timezone ?? 'UTC'

  const [data, setData] = useState<Paginated<CustomerRequestDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerRefDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleRefDto[]>([])
  const [services, setServices] = useState<ServiceRefDto[]>([])
  const [appointments, setAppointments] = useState<AppointmentRefDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<CustomerRequestStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<CustomerRequestSource | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)

  // Cross-navigation from Client Detail / Conversation Detail
  // (/requests?open=<id>) — same mechanism as Prompt 23's ?open= handling
  // on /conversations and /clients.
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
      const [customersResult, vehiclesResult, servicesResult, appointmentsResult] = await Promise.all([
        apiFetch<Paginated<CustomerRefDto>>('/api/customers?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<VehicleRefDto>>('/api/vehicles?pageSize=100&includeInactive=true'),
        apiFetch<{ services: ServiceRefDto[] }>('/api/services?activeOnly=false'),
        apiFetch<Paginated<AppointmentRefDto>>('/api/appointments?pageSize=100&includeCancelled=true'),
      ])
      setCustomers(customersResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
      setAppointments(appointmentsResult.items)
    } catch {
      // Non-fatal: the request list/detail still work, just fall back to raw ids.
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
      setListError('Не удалось загрузить заявки.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sourceFilter, search, refreshKey])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, sourceFilter, search])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function resetFilters() {
    setSearchInput('')
    setStatusFilter('')
    setSourceFilter('')
  }

  const hasActiveFilters = searchInput.trim() !== '' || statusFilter !== '' || sourceFilter !== ''

  function openDetail(id: string) {
    setOpenId(id)
  }

  function closeDetail() {
    setOpenId(null)
  }

  function handleDetailChanged() {
    void loadRequests()
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
      await apiFetch('/api/customer-requests', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          vehicleId: form.vehicleId === '' ? null : form.vehicleId,
          serviceId: form.serviceId === '' ? null : form.serviceId,
          subject: form.subject,
          description: form.description === '' ? null : form.description,
          requestedDate: form.requestedDate ? zonedTimeToUtc(form.requestedDate, '00:00', timezone).toISOString() : null,
          requestedTimeFrom: form.requestedTimeFrom === '' ? null : form.requestedTimeFrom,
          requestedTimeTo: form.requestedTimeTo === '' ? null : form.requestedTimeTo,
          source: form.source,
        }),
      })
      closeForm()
      await loadRequests()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось создать заявку.')
      }
    } finally {
      setSaving(false)
    }
  }

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)

  // Request Detail v1 (Prompt 24) — same full-screen-swap pattern as
  // Conversation Detail / Client Detail: no new route.
  if (openId) {
    return (
      <PageContainer className="max-w-5xl">
        <RequestDetailPanel
          requestId={openId}
          canManage={canManage}
          timezone={timezone}
          customers={customers}
          vehicles={vehicles}
          services={services}
          appointments={appointments}
          onBack={closeDetail}
          onChanged={handleDetailChanged}
        />
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader
        title="Заявки"
        subtitle="Все заявки клиентов в одном месте"
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0}>
              <Plus className="mr-1 h-4 w-4" />
              Новая заявка
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Поиск по теме или описанию..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-9 w-full sm:w-64"
              aria-label="Поиск заявок"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerRequestStatus | '')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по статусу"
            >
              <option value="">Все статусы</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as CustomerRequestSource | '')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по источнику"
            >
              <option value="">Все источники</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
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

          {!loading && !listError && data?.items.length === 0 && !hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Заявок пока нет</p>
            </div>
          )}

          {!loading && !listError && data?.items.length === 0 && hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">По вашему запросу ничего не найдено</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          )}

          {!loading &&
            !listError &&
            data?.items.map((request) => (
              <button
                key={request.id}
                type="button"
                onClick={() => openDetail(request.id)}
                className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{request.subject}</div>
                  <p className="truncate text-sm text-muted-foreground">
                    {customerName(customers, request.customerId)} · {vehicleLabel(vehicles, request.vehicleId) ?? '—'} ·{' '}
                    {serviceName(services, request.serviceId) ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatActivity(request.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="default">{REQUEST_STATUS_LABELS[request.status]}</Badge>
                </div>
              </button>
            ))}

          {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
        </CardContent>
      </Card>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Новая заявка</h2>
            <p className="text-sm text-muted-foreground">Желаемая дата указывается в часовом поясе автосервиса ({timezone}).</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cr-customer">Клиент</Label>
                  <select
                    id="cr-customer"
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
                  <Label htmlFor="cr-vehicle">Автомобиль (опционально)</Label>
                  <select
                    id="cr-vehicle"
                    value={form.vehicleId}
                    onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="">Нет</option>
                    {customerVehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {vehicleLabel(vehicles, v.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cr-service">Услуга (опционально)</Label>
                <select
                  id="cr-service"
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  <option value="">Нет</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cr-subject">Тема</Label>
                <Input id="cr-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
                {fieldErrors.subject && <p className="text-sm text-destructive">{fieldErrors.subject[0]}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cr-description">Описание</Label>
                <Textarea id="cr-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="cr-date">Желаемая дата (опционально)</Label>
                  <Input id="cr-date" type="date" value={form.requestedDate} onChange={(e) => setForm({ ...form, requestedDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cr-time-from">Время с (опционально)</Label>
                  <Input id="cr-time-from" type="time" value={form.requestedTimeFrom} onChange={(e) => setForm({ ...form, requestedTimeFrom: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cr-time-to">Время до (опционально)</Label>
                  <Input id="cr-time-to" type="time" value={form.requestedTimeTo} onChange={(e) => setForm({ ...form, requestedTimeTo: e.target.value })} />
                </div>
              </div>
              {fieldErrors.requestedTimeTo && <p className="text-sm text-destructive">{fieldErrors.requestedTimeTo[0]}</p>}

              <div className="space-y-2">
                <Label htmlFor="cr-source">Источник</Label>
                <select
                  id="cr-source"
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value as CustomerRequestSource })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>

              {formError && <p className="text-sm text-destructive">{formError}</p>}

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
