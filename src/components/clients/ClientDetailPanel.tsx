import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, UserX, UserCheck, RefreshCw, Plus, MessageSquare } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import {
  type CustomerDto,
  type VehicleDto,
  type CustomerRequestDto,
  type ConversationDto,
  type ServiceRecordDto,
  type ConversationChannel,
  type Paginated,
  REQUEST_STATUS_LABELS,
  CHANNEL_LABELS,
  formatActivity,
  formatDate,
  customerDisplayName,
  vehicleLabel,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 23 — Clients v1: Client Detail.
//
// Architecture: no inline/detail pattern existed for Customers before this
// prompt (the old page was a flat list + edit form, confirmed by audit) —
// so this is a new detail view, built to match the same pattern already
// established for Conversation Detail (Prompt 22): the list is replaced
// full-screen by this panel, on the same /clients route, no new route.
//
// Data sources (audited, not assumed):
//   Customer + vehicles -> GET /api/customers/:id?includeVehicles=true
//     (one call already returns both — confirmed via api/customers/[id].ts).
//   Requests            -> GET /api/customer-requests?customerId=&pageSize=5
//   Conversations       -> GET /api/conversations?customerId=&pageSize=5
//   Service history     -> GET /api/service-history?customerId=&pageSize=5
// All four run in parallel via Promise.allSettled — one detail view, not a
// list, so this is not an N+1 pattern (spec §20-21).
// ---------------------------------------------------------------------------

interface EditFormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes: string
}

interface VehicleFormState {
  make: string
  model: string
  year: string
  licensePlate: string
  vin: string
}

const EMPTY_VEHICLE_FORM: VehicleFormState = { make: '', model: '', year: '', licensePlate: '', vin: '' }

export interface ClientDetailPanelProps {
  customerId: string
  canManage: boolean
  onBack: () => void
  onChanged: () => void
}

export function ClientDetailPanel({ customerId, canManage, onBack, onChanged }: ClientDetailPanelProps) {
  const navigate = useNavigate()

  const [customer, setCustomer] = useState<CustomerDto | null>(null)
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [requests, setRequests] = useState<CustomerRequestDto[]>([])
  const [requestsError, setRequestsError] = useState(false)
  const [conversations, setConversations] = useState<ConversationDto[]>([])
  const [conversationsError, setConversationsError] = useState(false)
  const [history, setHistory] = useState<ServiceRecordDto[]>([])
  const [historyError, setHistoryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({ firstName: '', lastName: '', phone: '', email: '', notes: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Quick actions (spec §19) — small, honest forms over the exact existing
  // create endpoints, customerId pre-filled. Never a new backend operation.
  const [showConvForm, setShowConvForm] = useState(false)
  const [convChannel, setConvChannel] = useState<ConversationChannel>('MANUAL')
  const [convSubject, setConvSubject] = useState('')
  const [convSaving, setConvSaving] = useState(false)
  const [convError, setConvError] = useState<string | null>(null)

  const [showRequestForm, setShowRequestForm] = useState(false)
  const [requestSubject, setRequestSubject] = useState('')
  const [requestSaving, setRequestSaving] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)

  const [showVehicleForm, setShowVehicleForm] = useState(false)
  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>(EMPTY_VEHICLE_FORM)
  const [vehicleSaving, setVehicleSaving] = useState(false)
  const [vehicleError, setVehicleError] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [customerResult, requestsResult, conversationsResult, historyResult] = await Promise.allSettled([
      apiFetch<{ customer: CustomerDto; vehicles: VehicleDto[] }>(`/api/customers/${customerId}?includeVehicles=true`),
      apiFetch<Paginated<CustomerRequestDto>>(`/api/customer-requests?customerId=${customerId}&pageSize=5`),
      apiFetch<Paginated<ConversationDto>>(`/api/conversations?customerId=${customerId}&pageSize=5`),
      apiFetch<Paginated<ServiceRecordDto>>(`/api/service-history?customerId=${customerId}&pageSize=5`),
    ])

    if (customerResult.status === 'fulfilled') {
      setCustomer(customerResult.value.customer)
      setVehicles(customerResult.value.vehicles ?? [])
    } else {
      setError('Не удалось загрузить клиента.')
    }
    setRequests(requestsResult.status === 'fulfilled' ? requestsResult.value.items : [])
    setRequestsError(requestsResult.status !== 'fulfilled')
    setConversations(conversationsResult.status === 'fulfilled' ? conversationsResult.value.items : [])
    setConversationsError(conversationsResult.status !== 'fulfilled')
    setHistory(historyResult.status === 'fulfilled' ? historyResult.value.items : [])
    setHistoryError(historyResult.status !== 'fulfilled')
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function openEdit() {
    if (!customer) return
    setEditForm({
      firstName: customer.firstName,
      lastName: customer.lastName ?? '',
      phone: customer.phone,
      email: customer.email ?? '',
      notes: customer.notes ?? '',
    })
    setEditError(null)
    setEditFieldErrors({})
    setEditing(true)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    setEditError(null)
    setEditFieldErrors({})
    setSaving(true)
    try {
      await apiFetch(`/api/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(editForm) })
      setEditing(false)
      await loadAll()
      onChanged()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditError(err.message || 'Проверьте заполненные поля.')
        setEditFieldErrors(err.fieldErrors)
      } else {
        setEditError('Не удалось сохранить клиента.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive() {
    if (!customer) return
    setStatusError(null)
    try {
      if (customer.isActive) {
        await apiFetch(`/api/customers/${customerId}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify({ isActive: true }) })
      }
      await loadAll()
      onChanged()
    } catch (err) {
      setStatusError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус клиента.')
    }
  }

  async function handleCreateConversation(e: FormEvent) {
    e.preventDefault()
    setConvError(null)
    setConvSaving(true)
    try {
      await apiFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({ customerId, channel: convChannel, subject: convSubject.trim() || null }),
      })
      setShowConvForm(false)
      setConvSubject('')
      await loadAll()
    } catch (err) {
      setConvError(err instanceof ApiClientError ? err.message : 'Не удалось создать обращение.')
    } finally {
      setConvSaving(false)
    }
  }

  async function handleCreateRequest(e: FormEvent) {
    e.preventDefault()
    setRequestError(null)
    setRequestSaving(true)
    try {
      await apiFetch('/api/customer-requests', {
        method: 'POST',
        body: JSON.stringify({ customerId, source: 'MANUAL', subject: requestSubject.trim() }),
      })
      setShowRequestForm(false)
      setRequestSubject('')
      await loadAll()
    } catch (err) {
      setRequestError(err instanceof ApiClientError ? err.message : 'Не удалось создать заявку.')
    } finally {
      setRequestSaving(false)
    }
  }

  async function handleCreateVehicle(e: FormEvent) {
    e.preventDefault()
    setVehicleError(null)
    setVehicleSaving(true)
    try {
      await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          make: vehicleForm.make.trim(),
          model: vehicleForm.model.trim(),
          year: vehicleForm.year.trim() ? Number(vehicleForm.year) : null,
          licensePlate: vehicleForm.licensePlate.trim() || null,
          vin: vehicleForm.vin.trim() || null,
        }),
      })
      setShowVehicleForm(false)
      setVehicleForm(EMPTY_VEHICLE_FORM)
      await loadAll()
    } catch (err) {
      setVehicleError(err instanceof ApiClientError ? err.message : 'Не удалось добавить автомобиль.')
    } finally {
      setVehicleSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Назад к клиентам
        </Button>
        {customer && canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="mr-1 h-4 w-4" />
              Редактировать
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggleActive}>
              {customer.isActive ? (
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
      {customer && (
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold">{customerDisplayName(customer)}</div>
            <Badge variant={customer.isActive ? 'success' : 'default'}>{customer.isActive ? 'Активен' : 'Неактивен'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
          </p>
          {customer.notes && <p className="mt-1 text-sm text-muted-foreground">{customer.notes}</p>}
          {statusError && <p className="mt-1 text-sm text-destructive">{statusError}</p>}
        </div>
      )}

      {/* Edit form */}
      {editing && customer && (
        <div className="border-b border-border p-4">
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-first">Имя</Label>
                <Input id="edit-first" required value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                {editFieldErrors.firstName && <p className="text-sm text-destructive">{editFieldErrors.firstName[0]}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-last">Фамилия</Label>
                <Input id="edit-last" value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Телефон</Label>
                <Input id="edit-phone" required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                {editFieldErrors.phone && <p className="text-sm text-destructive">{editFieldErrors.phone[0]}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                {editFieldErrors.email && <p className="text-sm text-destructive">{editFieldErrors.email[0]}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Заметки</Label>
              <Textarea id="edit-notes" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
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
      {!loading && !error && customer && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          {/* Vehicles */}
          <section className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Автомобили</h3>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setShowVehicleForm((v) => !v)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Добавить
                </Button>
              )}
            </div>
            {showVehicleForm && (
              <form onSubmit={handleCreateVehicle} className="space-y-2 rounded-md border border-border p-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Марка" required value={vehicleForm.make} onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })} />
                  <Input placeholder="Модель" required value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="Год" inputMode="numeric" value={vehicleForm.year} onChange={(e) => setVehicleForm({ ...vehicleForm, year: e.target.value })} />
                  <Input placeholder="Гос. номер" value={vehicleForm.licensePlate} onChange={(e) => setVehicleForm({ ...vehicleForm, licensePlate: e.target.value })} />
                  <Input placeholder="VIN" value={vehicleForm.vin} onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value })} />
                </div>
                {vehicleError && <p className="text-sm text-destructive">{vehicleError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={vehicleSaving}>
                    {vehicleSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowVehicleForm(false)}>
                    Отмена
                  </Button>
                </div>
              </form>
            )}
            {vehicles.length === 0 && <p className="text-sm text-muted-foreground">Автомобилей у клиента пока нет</p>}
            {vehicles.map((v) => (
              <div key={v.id} className="rounded-md border border-border p-2 text-sm">
                <div className="font-medium">{vehicleLabel(v)}</div>
                {(v.licensePlate || v.vin) && (
                  <div className="text-muted-foreground">{[v.licensePlate, v.vin].filter(Boolean).join(' · ')}</div>
                )}
              </div>
            ))}
          </section>

          {/* Requests */}
          <section className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Заявки</h3>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setShowRequestForm((v) => !v)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Новая
                </Button>
              )}
            </div>
            {showRequestForm && (
              <form onSubmit={handleCreateRequest} className="space-y-2 rounded-md border border-border p-2">
                <Input placeholder="Тема заявки" required value={requestSubject} onChange={(e) => setRequestSubject(e.target.value)} />
                {requestError && <p className="text-sm text-destructive">{requestError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={requestSaving}>
                    {requestSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowRequestForm(false)}>
                    Отмена
                  </Button>
                </div>
              </form>
            )}
            {requestsError && <p className="text-sm text-destructive">Не удалось загрузить заявки</p>}
            {!requestsError && requests.length === 0 && <p className="text-sm text-muted-foreground">Заявок пока нет</p>}
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                <span className="truncate">{r.subject}</span>
                <Badge variant="default">{REQUEST_STATUS_LABELS[r.status]}</Badge>
              </div>
            ))}
          </section>

          {/* Conversations */}
          <section className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Обращения</h3>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => setShowConvForm((v) => !v)}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Новое
                </Button>
              )}
            </div>
            {showConvForm && (
              <form onSubmit={handleCreateConversation} className="space-y-2 rounded-md border border-border p-2">
                <select
                  value={convChannel}
                  onChange={(e) => setConvChannel(e.target.value as ConversationChannel)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {(['MANUAL', 'WEBSITE', 'TELEGRAM', 'WHATSAPP', 'PHONE', 'OTHER'] as ConversationChannel[]).map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
                <Input placeholder="Тема (опционально)" value={convSubject} onChange={(e) => setConvSubject(e.target.value)} />
                {convError && <p className="text-sm text-destructive">{convError}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={convSaving}>
                    {convSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowConvForm(false)}>
                    Отмена
                  </Button>
                </div>
              </form>
            )}
            {conversationsError && <p className="text-sm text-destructive">Не удалось загрузить обращения</p>}
            {!conversationsError && conversations.length === 0 && <p className="text-sm text-muted-foreground">Обращений пока нет</p>}
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/conversations?open=${c.id}`)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <span className="truncate">
                  <MessageSquare className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
                  {c.subject ?? '(без темы)'}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatActivity(c.lastMessageAt ?? c.createdAt)}</span>
              </button>
            ))}
          </section>

          {/* Service history */}
          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="text-sm font-semibold">История обслуживания</h3>
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
