import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, RefreshCw } from 'lucide-react'
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
import { VehicleDetailPanel } from '../../components/vehicles/VehicleDetailPanel'
import { type VehicleDto, type CustomerRefDto, type Paginated, customerName, vehicleLabel } from '../../components/vehicles/shared'

// ---------------------------------------------------------------------------
// Prompt 26 — Vehicle Context v1, built on the existing
// GET/POST/PATCH/DELETE /api/vehicles endpoints (unchanged since Prompt 04).
// Canonical route: /vehicles (previously only reachable at
// /settings/vehicles, which is not part of the primary nav).
// /settings/vehicles now redirects here, its SettingsHubPage card was
// removed, and a "Автомобили" sidebar item was added — the same
// "single source of truth" pattern used for Conversations/Clients/
// Requests (Prompts 19/21/23/24).
// ---------------------------------------------------------------------------

interface CreateFormState {
  customerId: string
  make: string
  model: string
  year: string
  licensePlate: string
  vin: string
  mileage: string
  notes: string
}

const EMPTY_FORM: CreateFormState = { customerId: '', make: '', model: '', year: '', licensePlate: '', vin: '', mileage: '', notes: '' }

/** 300ms debounce on the search box — same convention as Conversations/Clients/Requests v1. The backend already supports search (make/model/plate/VIN); this page just hadn't wired a search box to it before. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function VehiclesSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [data, setData] = useState<Paginated<VehicleDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerRefDto[]>([])
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [customerFilter, setCustomerFilter] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)

  // Cross-navigation from Client/Request/Conversation Detail
  // (/vehicles?open=<id>) — same mechanism as Prompts 23-25's own
  // ?open= handling.
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
    try {
      const result = await apiFetch<Paginated<CustomerRefDto>>('/api/customers?pageSize=100&includeInactive=true')
      setCustomers(result.items)
    } catch {
      // Non-fatal: the vehicle list/detail still work, just fall back to "Неизвестный клиент".
    }
  }

  async function loadVehicles() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (search.trim()) params.set('search', search.trim())
      if (customerFilter) params.set('customerId', customerFilter)
      if (includeInactive) params.set('includeInactive', 'true')
      const result = await apiFetch<Paginated<VehicleDto>>(`/api/vehicles?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить автомобили.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void loadVehicles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, customerFilter, includeInactive, refreshKey])

  useEffect(() => {
    setPage(1)
  }, [search, customerFilter, includeInactive])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function resetFilters() {
    setSearchInput('')
    setCustomerFilter('')
    setIncludeInactive(false)
  }

  const hasActiveFilters = searchInput.trim() !== '' || customerFilter !== '' || includeInactive

  function openDetail(id: string) {
    setOpenId(id)
  }

  function closeDetail() {
    setOpenId(null)
  }

  function handleDetailChanged() {
    void loadVehicles()
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
      await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          customerId: form.customerId,
          make: form.make,
          model: form.model,
          year: form.year === '' ? null : Number(form.year),
          licensePlate: form.licensePlate === '' ? null : form.licensePlate,
          vin: form.vin === '' ? null : form.vin,
          mileage: form.mileage === '' ? null : Number(form.mileage),
          notes: form.notes === '' ? null : form.notes,
        }),
      })
      closeForm()
      await loadVehicles()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить автомобиль.')
      }
    } finally {
      setSaving(false)
    }
  }

  // Vehicle Detail v1 (Prompt 26) — same full-screen-swap pattern as
  // Conversation/Client/Request Detail: no new route beyond /vehicles itself.
  if (openId) {
    return (
      <PageContainer className="max-w-5xl">
        <VehicleDetailPanel vehicleId={openId} canManage={canManage} customers={customers} onBack={closeDetail} onChanged={handleDetailChanged} />
      </PageContainer>
    )
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader
        title="Автомобили"
        subtitle="Все автомобили клиентов в одном месте"
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0}>
              <Plus className="mr-1 h-4 w-4" />
              Новый автомобиль
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Марка, модель, номер, VIN..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 pl-9"
                aria-label="Поиск автомобилей"
              />
            </div>
            <select
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по клиенту"
            >
              <option value="">Все клиенты</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Показать неактивные
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
              <p className="text-sm font-medium">Автомобилей пока нет</p>
            </div>
          )}

          {!loading && !listError && data?.items.length === 0 && hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Ничего не найдено</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          )}

          {!loading &&
            !listError &&
            data?.items.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => openDetail(vehicle.id)}
                className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{vehicleLabel(vehicle)}</div>
                  <p className="truncate text-sm text-muted-foreground">
                    {vehicle.licensePlate ?? '—'} · {customerName(customers, vehicle.customerId)}
                  </p>
                </div>
                <Badge variant={vehicle.isActive ? 'success' : 'default'}>{vehicle.isActive ? 'Активен' : 'Неактивен'}</Badge>
              </button>
            ))}

          {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
        </CardContent>
      </Card>

      {showForm && canManage && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold leading-none tracking-tight">Новый автомобиль</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="veh-customer">Клиент</Label>
                <select
                  id="veh-customer"
                  required
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="veh-make">Марка</Label>
                  <Input id="veh-make" required value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
                  {fieldErrors.make && <p className="text-sm text-destructive">{fieldErrors.make[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="veh-model">Модель</Label>
                  <Input id="veh-model" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                  {fieldErrors.model && <p className="text-sm text-destructive">{fieldErrors.model[0]}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="veh-year">Год</Label>
                  <Input id="veh-year" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                  {fieldErrors.year && <p className="text-sm text-destructive">{fieldErrors.year[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="veh-plate">Гос. номер</Label>
                  <Input id="veh-plate" value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="veh-mileage">Пробег (км)</Label>
                  <Input id="veh-mileage" type="number" min="0" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} />
                  {fieldErrors.mileage && <p className="text-sm text-destructive">{fieldErrors.mileage[0]}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="veh-vin">VIN</Label>
                <Input id="veh-vin" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="veh-notes">Заметки</Label>
                <Textarea id="veh-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
