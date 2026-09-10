import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, RefreshCw, Car, ClipboardList } from 'lucide-react'
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
import { ClientDetailPanel } from '../../components/clients/ClientDetailPanel'
import { type CustomerDto, type VehicleDto, type CustomerRequestDto, type Paginated, customerDisplayName } from '../../components/clients/shared'

// ---------------------------------------------------------------------------
// Prompt 23 — Clients v1, built on the existing GET/POST/PATCH/DELETE
// /api/customers endpoints (unchanged since Prompt 04). No new backend.
//
// Vehicle/request COUNTS on the list are computed client-side from the
// same reference-data-fetch-once pattern already established by the
// Dashboard/Conversations pages (GET /api/vehicles and
// GET /api/customer-requests at the backend's own pageSize=100 cap) —
// avoids per-row (N+1) requests, at the cost of undercounting if a tenant
// has more than 100 vehicles/requests total (documented in the Final
// Report, same limitation already accepted for name-resolution elsewhere).
// ---------------------------------------------------------------------------

interface PaginatedCustomers {
  items: CustomerDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface FormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes: string
}

const EMPTY_FORM: FormState = { firstName: '', lastName: '', phone: '', email: '', notes: '' }

/** 300ms debounce on the search box only — same convention as Conversations v1. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function CustomersSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [data, setData] = useState<PaginatedCustomers | null>(null)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Reference data for the list's Vehicles/Requests count columns — see
  // header comment. Non-fatal: on failure the columns just show "—".
  const [vehicleCounts, setVehicleCounts] = useState<Map<string, number> | null>(null)
  const [requestCounts, setRequestCounts] = useState<Map<string, number> | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)

  // Cross-navigation from Request Detail (/clients?open=<id>) — same
  // mechanism as /conversations' own ?open= handling (Prompt 23).
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const toOpen = searchParams.get('open')
    if (toOpen) {
      setOpenId(toOpen)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadCustomers() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (search.trim()) params.set('search', search.trim())
      if (includeInactive) params.set('includeInactive', 'true')
      const result = await apiFetch<PaginatedCustomers>(`/api/customers?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить клиентов.')
    } finally {
      setLoading(false)
    }
  }

  async function loadCounts() {
    try {
      const [vehiclesResult, requestsResult] = await Promise.all([
        apiFetch<Paginated<VehicleDto>>('/api/vehicles?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<CustomerRequestDto>>('/api/customer-requests?pageSize=100'),
      ])
      const vMap = new Map<string, number>()
      for (const v of vehiclesResult.items) vMap.set(v.customerId, (vMap.get(v.customerId) ?? 0) + 1)
      const rMap = new Map<string, number>()
      for (const r of requestsResult.items) rMap.set(r.customerId, (rMap.get(r.customerId) ?? 0) + 1)
      setVehicleCounts(vMap)
      setRequestCounts(rMap)
    } catch {
      setVehicleCounts(null)
      setRequestCounts(null)
    }
  }

  useEffect(() => {
    void loadCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, includeInactive, refreshKey])

  useEffect(() => {
    setPage(1)
  }, [search, includeInactive])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function resetFilters() {
    setSearchInput('')
    setIncludeInactive(false)
  }

  const hasActiveFilters = searchInput.trim() !== '' || includeInactive

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
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
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(form) })
      closeForm()
      await loadCustomers()
      void loadCounts()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить клиента.')
      }
    } finally {
      setSaving(false)
    }
  }

  function openDetail(id: string) {
    setOpenId(id)
  }

  function closeDetail() {
    setOpenId(null)
  }

  function handleDetailChanged() {
    void loadCustomers()
    void loadCounts()
  }

  // Client Detail v1 (Prompt 23) — same full-screen-swap pattern as
  // Conversation Detail (Prompt 22): no new route, no second /clients/:id
  // implementation, an open client simply replaces the list on this page.
  if (openId) {
    return (
      <PageContainer className="max-w-5xl">
        <ClientDetailPanel customerId={openId} canManage={canManage} onBack={closeDetail} onChanged={handleDetailChanged} />
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader
        title="Клиенты"
        subtitle="База клиентов автосервиса"
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreateForm}>
              <Plus className="mr-1 h-4 w-4" />
              Новый клиент
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Поиск по имени, телефону, email..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-9 w-full sm:w-72"
              aria-label="Поиск клиентов"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Показать неактивных
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md border border-border bg-muted/40" />
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
              <p className="text-sm font-medium">Клиентов пока нет</p>
            </div>
          )}

          {!loading && !listError && data?.items.length === 0 && hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Ничего не найдено</p>
              <p className="mt-1 text-sm text-muted-foreground">Попробуйте изменить параметры поиска.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          )}

          {!loading &&
            !listError &&
            data?.items.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => openDetail(customer.id)}
                className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{customerDisplayName(customer)}</div>
                  <p className="truncate text-sm text-muted-foreground">
                    {customer.phone}
                    {customer.email ? ` · ${customer.email}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1" aria-label={`Автомобилей: ${vehicleCounts?.get(customer.id) ?? 'неизвестно'}`}>
                    <Car className="h-4 w-4" aria-hidden="true" />
                    {vehicleCounts?.get(customer.id) ?? '—'}
                  </span>
                  <span className="flex items-center gap-1" aria-label={`Заявок: ${requestCounts?.get(customer.id) ?? 'неизвестно'}`}>
                    <ClipboardList className="h-4 w-4" aria-hidden="true" />
                    {requestCounts?.get(customer.id) ?? '—'}
                  </span>
                  <Badge variant={customer.isActive ? 'success' : 'default'}>{customer.isActive ? 'Активен' : 'Неактивен'}</Badge>
                </div>
              </button>
            ))}

          {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          {(vehicleCounts === null || requestCounts === null) && !loading && data && data.items.length > 0 && (
            <p className="pt-1 text-center text-xs text-muted-foreground">Счётчики автомобилей/заявок временно недоступны.</p>
          )}
        </CardContent>
      </Card>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Новый клиент</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cust-first">Имя</Label>
                  <Input
                    id="cust-first"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  />
                  {fieldErrors.firstName && <p className="text-sm text-destructive">{fieldErrors.firstName[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-last">Фамилия</Label>
                  <Input id="cust-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cust-phone">Телефон</Label>
                  <Input
                    id="cust-phone"
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                  {fieldErrors.phone && <p className="text-sm text-destructive">{fieldErrors.phone[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cust-email">Email</Label>
                  <Input
                    id="cust-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cust-notes">Заметки</Label>
                <Textarea id="cust-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
