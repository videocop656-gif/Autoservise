import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, UserX, UserCheck, RefreshCw, User, ClipboardList, History, ArrowRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import {
  type VehicleDto,
  type CustomerRefDto,
  type CustomerRequestRefDto,
  type ServiceRecordDto,
  type Paginated,
  customerName,
  REQUEST_STATUS_LABELS,
  formatActivity,
  formatDate,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 26 — Vehicle Context v1: Vehicle Detail.
//
// Audit result (see Final Report §1-3): Vehicle has real, direct relations
// to Customer (owner), CustomerRequest[] (vehicleId FK), and
// ServiceRecord[] (vehicleId FK) — confirmed in prisma/schema.prisma. It
// has NO direct relation to Conversation (Conversation only has
// customerId/customerRequestId, no vehicleId), so no "Conversations"
// section exists here — a two-hop derived join (vehicle -> its requests ->
// their conversations) was considered and deliberately rejected as too
// fragile/indirect to present as a real relation; documented as a
// limitation rather than built.
//
// Data sources:
//   Vehicle itself      -> GET /api/vehicles/:id (unchanged)
//   Owner               -> resolved from the SAME customers reference list
//     the parent list page already fetches once (pageSize=100) — zero
//     extra requests, same pattern as every other Detail panel in this app.
//   Requests            -> GET /api/customer-requests?vehicleId= (the real
//     FK-backed filter, confirmed via customerRequestService.ts)
//   Service history      -> GET /api/service-history?vehicleId= (the real
//     FK-backed filter, confirmed via serviceRecordService.ts) — shows a
//     compact recent slice and links to the existing, unmodified full
//     history page (/settings/service-history?vehicleId=) rather than
//     duplicating that page's own pagination/CRUD here.
//
// All three run in parallel via Promise.allSettled — one detail view for
// one vehicle, not a list, so this is not an N+1 pattern.
// ---------------------------------------------------------------------------

interface EditFormState {
  make: string
  model: string
  year: string
  licensePlate: string
  vin: string
  mileage: string
  notes: string
}

export interface VehicleDetailPanelProps {
  vehicleId: string
  canManage: boolean
  customers: CustomerRefDto[]
  onBack: () => void
  onChanged: () => void
}

export function VehicleDetailPanel({ vehicleId, canManage, customers, onBack, onChanged }: VehicleDetailPanelProps) {
  const navigate = useNavigate()

  const [vehicle, setVehicle] = useState<VehicleDto | null>(null)
  const [requests, setRequests] = useState<CustomerRequestRefDto[]>([])
  const [requestsError, setRequestsError] = useState(false)
  const [history, setHistory] = useState<ServiceRecordDto[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditFormState>({ make: '', model: '', year: '', licensePlate: '', vin: '', mileage: '', notes: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [vehicleResult, requestsResult, historyResult] = await Promise.allSettled([
      apiFetch<{ vehicle: VehicleDto }>(`/api/vehicles/${vehicleId}`),
      apiFetch<Paginated<CustomerRequestRefDto>>(`/api/customer-requests?vehicleId=${vehicleId}&pageSize=20`),
      apiFetch<Paginated<ServiceRecordDto>>(`/api/service-history?vehicleId=${vehicleId}&pageSize=5`),
    ])

    if (vehicleResult.status === 'fulfilled') {
      setVehicle(vehicleResult.value.vehicle)
    } else {
      setError('Не удалось загрузить автомобиль.')
    }
    setRequests(requestsResult.status === 'fulfilled' ? requestsResult.value.items : [])
    setRequestsError(requestsResult.status !== 'fulfilled')
    setHistory(historyResult.status === 'fulfilled' ? historyResult.value.items : [])
    setHistoryError(historyResult.status !== 'fulfilled')
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function openEdit() {
    if (!vehicle) return
    setForm({
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
    setEditing(true)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      await apiFetch(`/api/vehicles/${vehicleId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          make: form.make,
          model: form.model,
          year: form.year === '' ? null : Number(form.year),
          licensePlate: form.licensePlate === '' ? null : form.licensePlate,
          vin: form.vin === '' ? null : form.vin,
          mileage: form.mileage === '' ? null : Number(form.mileage),
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
        setFormError('Не удалось сохранить автомобиль.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive() {
    if (!vehicle) return
    setStatusError(null)
    try {
      if (vehicle.isActive) {
        await apiFetch(`/api/vehicles/${vehicleId}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/vehicles/${vehicleId}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })
      }
      await loadAll()
      onChanged()
    } catch (err) {
      setStatusError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус автомобиля.')
    }
  }

  const customer = vehicle ? customers.find((c) => c.id === vehicle.customerId) : undefined

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Назад к автомобилям
        </Button>
        {vehicle && canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-1 h-4 w-4" />
              Редактировать
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggleActive}>
              {vehicle.isActive ? (
                <>
                  <UserX className="mr-1 h-4 w-4" />
                  Деактивировать
                </>
              ) : (
                <>
                  <UserCheck className="mr-1 h-4 w-4" />
                  Активировать
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      {vehicle && (
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold">
              {vehicle.make} {vehicle.model} {vehicle.year ? `(${vehicle.year})` : ''}
            </div>
            <Badge variant={vehicle.isActive ? 'success' : 'default'}>{vehicle.isActive ? 'Активен' : 'Неактивен'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[vehicle.licensePlate, vehicle.vin, vehicle.mileage != null ? `${vehicle.mileage} км` : null].filter(Boolean).join(' · ') || 'Дополнительные данные не указаны'}
          </p>
          {vehicle.notes && <p className="mt-1 text-sm text-muted-foreground">{vehicle.notes}</p>}
          {statusError && <p className="mt-1 text-sm text-destructive">{statusError}</p>}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="border-b border-border p-4">
          <form onSubmit={handleEditSubmit} className="space-y-4">
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
      {!loading && !error && vehicle && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="h-4 w-4 text-muted-foreground" />
              Владелец
            </h3>
            {customer ? (
              <button
                type="button"
                onClick={() => navigate(`/clients?open=${customer.id}`)}
                className="block w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <div className="font-medium">{customerName(customers, vehicle.customerId)}</div>
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
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Заявки
            </h3>
            {requestsError && <p className="text-sm text-destructive">Не удалось загрузить заявки</p>}
            {!requestsError && requests.length === 0 && <p className="text-sm text-muted-foreground">Заявок пока нет</p>}
            {requests.map((r) => (
              <Link
                key={r.id}
                to={`/requests?open=${r.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="truncate">{r.subject}</div>
                  <div className="text-xs text-muted-foreground">{formatActivity(r.createdAt)}</div>
                </div>
                <Badge variant="default">{REQUEST_STATUS_LABELS[r.status]}</Badge>
              </Link>
            ))}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="h-4 w-4 text-muted-foreground" />
                История обслуживания
              </h3>
              <Link
                to={`/settings/service-history?vehicleId=${vehicleId}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                Открыть полную историю
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {historyError && <p className="text-sm text-destructive">Не удалось загрузить историю обслуживания</p>}
            {!historyError && history.length === 0 && <p className="text-sm text-muted-foreground">История обслуживания пока отсутствует</p>}
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
