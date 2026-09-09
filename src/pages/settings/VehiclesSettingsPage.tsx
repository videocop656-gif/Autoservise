import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, History } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

interface VehicleDto {
  id: string
  customerId: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  vin: string | null
  mileage: number | null
  notes: string | null
  isActive: boolean
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
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
  make: string
  model: string
  year: string
  licensePlate: string
  vin: string
  mileage: string
  notes: string
}

const EMPTY_FORM: FormState = { customerId: '', make: '', model: '', year: '', licensePlate: '', vin: '', mileage: '', notes: '' }

export default function VehiclesSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [data, setData] = useState<Paginated<VehicleDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [page, setPage] = useState(1)
  const [customerFilter, setCustomerFilter] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  function customerLabel(customerId: string): string {
    const c = customers.find((x) => x.id === customerId)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : customerId
  }

  async function loadCustomers() {
    try {
      const result = await apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100')
      setCustomers(result.items)
    } catch {
      // Non-fatal: vehicle list still works, just shows raw ids as a fallback.
    }
  }

  async function loadVehicles() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
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
  }, [])

  useEffect(() => {
    void loadVehicles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, customerFilter, includeInactive])

  useEffect(() => {
    setPage(1)
  }, [customerFilter, includeInactive])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(vehicle: VehicleDto) {
    setEditingId(vehicle.id)
    setForm({
      customerId: vehicle.customerId,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year ? String(vehicle.year) : '',
      licensePlate: vehicle.licensePlate ?? '',
      vin: vehicle.vin ?? '',
      mileage: vehicle.mileage != null ? String(vehicle.mileage) : '',
      notes: vehicle.notes ?? '',
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

    const basePayload = {
      make: form.make,
      model: form.model,
      year: form.year === '' ? null : Number(form.year),
      licensePlate: form.licensePlate === '' ? null : form.licensePlate,
      vin: form.vin === '' ? null : form.vin,
      mileage: form.mileage === '' ? null : Number(form.mileage),
      notes: form.notes === '' ? null : form.notes,
    }

    try {
      if (editingId) {
        await apiFetch(`/api/vehicles/${editingId}`, { method: 'PATCH', body: JSON.stringify(basePayload) })
      } else {
        await apiFetch('/api/vehicles', { method: 'POST', body: JSON.stringify({ ...basePayload, customerId: form.customerId }) })
      }
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

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/vehicles/${id}`, { method: 'DELETE' })
      await loadVehicles()
    } catch {
      setListError('Не удалось деактивировать автомобиль.')
    }
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Автомобили</CardTitle>
              <CardDescription>Автомобили клиентов автосервиса.</CardDescription>
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
                <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                Показать неактивные
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Автомобилей пока нет.</p>}

            {data?.items.map((vehicle) => (
              <div key={vehicle.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {vehicle.make} {vehicle.model} {vehicle.year ? `(${vehicle.year})` : ''}
                    {!vehicle.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">неактивен</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {vehicle.licensePlate ?? '—'} · {customerLabel(vehicle.customerId)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={`/settings/service-history?vehicleId=${vehicle.id}`} title="Service history">
                      <History className="h-4 w-4" />
                    </Link>
                  </Button>
                  {canManage && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEditForm(vehicle)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {vehicle.isActive && (
                        <Button variant="outline" size="sm" onClick={() => handleDeactivate(vehicle.id)}>
                          Deactivate
                        </Button>
                      )}
                    </>
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
              <CardTitle>{editingId ? 'Редактировать автомобиль' : 'Новый автомобиль'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {!editingId && (
                  <div className="space-y-2">
                    <Label htmlFor="veh-customer">Customer</Label>
                    <select
                      id="veh-customer"
                      required
                      value={form.customerId}
                      onChange={(e) => setForm({ ...form, customerId: e.target.value })}
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
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="veh-make">Make</Label>
                    <Input id="veh-make" required value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
                    {fieldErrors.make && <p className="text-sm text-destructive">{fieldErrors.make[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="veh-model">Model</Label>
                    <Input
                      id="veh-model"
                      required
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                    />
                    {fieldErrors.model && <p className="text-sm text-destructive">{fieldErrors.model[0]}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="veh-year">Year</Label>
                    <Input
                      id="veh-year"
                      type="number"
                      value={form.year}
                      onChange={(e) => setForm({ ...form, year: e.target.value })}
                    />
                    {fieldErrors.year && <p className="text-sm text-destructive">{fieldErrors.year[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="veh-plate">License plate</Label>
                    <Input
                      id="veh-plate"
                      value={form.licensePlate}
                      onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="veh-mileage">Mileage (km)</Label>
                    <Input
                      id="veh-mileage"
                      type="number"
                      min="0"
                      value={form.mileage}
                      onChange={(e) => setForm({ ...form, mileage: e.target.value })}
                    />
                    {fieldErrors.mileage && <p className="text-sm text-destructive">{fieldErrors.mileage[0]}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="veh-vin">VIN</Label>
                  <Input id="veh-vin" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="veh-notes">Notes</Label>
                  <Textarea id="veh-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
    </PageContainer>
  )
}
