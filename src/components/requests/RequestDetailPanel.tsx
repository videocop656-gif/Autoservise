import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, RefreshCw, User, Car, Wrench, MessageSquare, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { zonedTimeToUtc, utcToZonedParts } from '../../lib/businessTime'
import {
  type CustomerRequestDto,
  type CustomerRequestStatus,
  type CustomerRequestSource,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type ConversationDto,
  type EscalationDto,
  type Paginated,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  customerName,
  vehicleLabel,
  serviceName,
  formatActivity,
  attentionBadgeVariant,
  isActiveEscalation,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 24 — Customer Requests v1: Request Detail.
//
// Architecture: no detail/inline pattern existed for CustomerRequest
// before this prompt — the old page used its "edit form" as a de facto
// detail view (subject/customer/vehicle/service dropdowns + status
// history), with no customer/vehicle/service/conversation *context*
// shown anywhere. This is a new detail view, built to match the exact
// full-screen-swap pattern already established for Conversation Detail
// (Prompt 22) and Client Detail (Prompt 23) — no new route.
//
// Data sources (audited, not assumed):
//   Request + status history -> GET /api/customer-requests/:id (unchanged)
//   Customer/Vehicle/Service  -> resolved from the SAME reference lists the
//     parent list page already fetches once (pageSize=100/unpaginated) —
//     zero extra requests, same pattern as Clients/Conversations.
//   Conversations             -> GET /api/conversations?customerRequestId=
//     (the real Conversation.customerRequestId relation — confirmed via
//     conversationRepository.ts's ListOptions — not a customerId-wide
//     fetch, which could include unrelated conversations).
//   Escalation                -> derived: only looked up
//     (GET /api/escalations?conversationId=) for the request's own most
//     recent linked conversation, if one exists. No CustomerRequest ->
//     AiEscalation relation exists directly, so without a linked
//     conversation this section is simply not shown (spec §20).
// ---------------------------------------------------------------------------

interface EditFormState {
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

interface AppointmentRefDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
}

const STATUSES: CustomerRequestStatus[] = ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'QUALIFIED', 'CONVERTED', 'CLOSED', 'CANCELLED']
const SOURCES: CustomerRequestSource[] = ['PHONE', 'WEBSITE', 'MANUAL', 'OTHER']

export interface RequestDetailPanelProps {
  requestId: string
  canManage: boolean
  timezone: string
  customers: CustomerRefDto[]
  vehicles: VehicleRefDto[]
  services: ServiceRefDto[]
  appointments: AppointmentRefDto[]
  onBack: () => void
  onChanged: () => void
}

export function RequestDetailPanel({
  requestId,
  canManage,
  timezone,
  customers,
  vehicles,
  services,
  appointments,
  onBack,
  onChanged,
}: RequestDetailPanelProps) {
  const navigate = useNavigate()

  const [request, setRequest] = useState<CustomerRequestDto | null>(null)
  const [conversations, setConversations] = useState<ConversationDto[]>([])
  const [conversationsError, setConversationsError] = useState(false)
  const [escalation, setEscalation] = useState<EscalationDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EditFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [requestResult, conversationsResult] = await Promise.allSettled([
      apiFetch<{ customerRequest: CustomerRequestDto }>(`/api/customer-requests/${requestId}`),
      apiFetch<Paginated<ConversationDto>>(`/api/conversations?customerRequestId=${requestId}&pageSize=5`),
    ])

    if (requestResult.status === 'fulfilled') {
      setRequest(requestResult.value.customerRequest)
    } else {
      setError('Не удалось загрузить заявку.')
    }

    if (conversationsResult.status === 'fulfilled') {
      const items = conversationsResult.value.items
      setConversations(items)
      setConversationsError(false)
      // Escalation has no direct relation to CustomerRequest — it is only
      // derivable through a linked Conversation. Looked up for the most
      // recent one only, a single extra request, not a per-row fetch.
      const primaryConversation = items[0]
      if (primaryConversation) {
        try {
          const escResult = await apiFetch<Paginated<EscalationDto>>(`/api/escalations?conversationId=${primaryConversation.id}&pageSize=5`)
          setEscalation(escResult.items[0] ?? null)
        } catch {
          setEscalation(null)
        }
      } else {
        setEscalation(null)
      }
    } else {
      setConversations([])
      setConversationsError(true)
      setEscalation(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  async function handleStatusChange(status: CustomerRequestStatus) {
    setStatusError(null)
    try {
      await apiFetch(`/api/customer-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadAll()
      onChanged()
    } catch (err) {
      setStatusError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  function openEdit() {
    if (!request) return
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
    setFormError(null)
    setFieldErrors({})
    setEditing(true)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setFormError(null)
    setFieldErrors({})
    setSaving(true)
    try {
      const requestedDate = form.requestedDate ? zonedTimeToUtc(form.requestedDate, '00:00', timezone).toISOString() : null
      await apiFetch(`/api/customer-requests/${requestId}`, {
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
      setEditing(false)
      await loadAll()
      onChanged()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить заявку.')
      }
    } finally {
      setSaving(false)
    }
  }

  const customer = request ? customers.find((c) => c.id === request.customerId) : undefined
  const vehicle = request?.vehicleId ? vehicles.find((v) => v.id === request.vehicleId) : undefined
  const service = request?.serviceId ? services.find((s) => s.id === request.serviceId) : undefined
  const customerVehicles = form ? vehicles.filter((v) => v.customerId === form.customerId) : []
  const matchingAppointments = form
    ? appointments.filter(
        (a) =>
          a.customerId === form.customerId &&
          (form.vehicleId === '' || a.vehicleId === form.vehicleId) &&
          (form.serviceId === '' || a.serviceId === form.serviceId)
      )
    : []

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Назад к заявкам
        </Button>
        {request && (
          <div className="flex flex-wrap items-center gap-2">
            {escalation && isActiveEscalation(escalation.status) && (
              <Badge variant={attentionBadgeVariant(escalation.priority)}>
                <AlertTriangle className="h-3 w-3" />
                Требует внимания
              </Badge>
            )}
            {canManage ? (
              <select
                value={request.status}
                onChange={(e) => handleStatusChange(e.target.value as CustomerRequestStatus)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Изменить статус заявки"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REQUEST_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            ) : (
              <Badge variant="default">{REQUEST_STATUS_LABELS[request.status]}</Badge>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Pencil className="mr-1 h-4 w-4" />
                Редактировать
              </Button>
            )}
          </div>
        )}
      </div>
      {request && (
        <div className="border-b border-border px-4 py-3">
          <div className="text-lg font-semibold">{request.subject}</div>
          <p className="text-sm text-muted-foreground">
            Создано: {formatActivity(request.createdAt)} · {SOURCE_LABELS[request.source]}
          </p>
          {request.description && <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>}
          {statusError && <p className="mt-1 text-sm text-destructive">{statusError}</p>}
        </div>
      )}

      {/* Edit form */}
      {editing && form && (
        <div className="border-b border-border p-4">
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="req-customer">Клиент</Label>
                <select
                  id="req-customer"
                  required
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '', appointmentId: '' })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="req-vehicle">Автомобиль (опционально)</Label>
                <select
                  id="req-vehicle"
                  value={form.vehicleId}
                  onChange={(e) => setForm({ ...form, vehicleId: e.target.value, appointmentId: '' })}
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="req-service">Услуга (опционально)</Label>
                <select
                  id="req-service"
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value, appointmentId: '' })}
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
                <Label htmlFor="req-appointment">Запись (опционально)</Label>
                <select
                  id="req-appointment"
                  value={form.appointmentId}
                  onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  <option value="">Нет</option>
                  {matchingAppointments.map((a) => {
                    const parts = utcToZonedParts(new Date(a.startAt), timezone)
                    return (
                      <option key={a.id} value={a.id}>
                        {parts.dateStr} {parts.timeStr}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="req-subject">Тема</Label>
              <Input id="req-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              {fieldErrors.subject && <p className="text-sm text-destructive">{fieldErrors.subject[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="req-description">Описание</Label>
              <Textarea id="req-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="req-date">Желаемая дата (опционально)</Label>
                <Input id="req-date" type="date" value={form.requestedDate} onChange={(e) => setForm({ ...form, requestedDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="req-time-from">Время с (опционально)</Label>
                <Input id="req-time-from" type="time" value={form.requestedTimeFrom} onChange={(e) => setForm({ ...form, requestedTimeFrom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="req-time-to">Время до (опционально)</Label>
                <Input id="req-time-to" type="time" value={form.requestedTimeTo} onChange={(e) => setForm({ ...form, requestedTimeTo: e.target.value })} />
              </div>
            </div>
            {fieldErrors.requestedTimeTo && <p className="text-sm text-destructive">{fieldErrors.requestedTimeTo[0]}</p>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="req-source">Источник</Label>
                <select
                  id="req-source"
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
              <div className="space-y-2">
                <Label htmlFor="req-status">Статус</Label>
                <select
                  id="req-status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as CustomerRequestStatus })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {REQUEST_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="req-notes">Заметки</Label>
              <Textarea id="req-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
      {!loading && !error && request && (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <User className="h-4 w-4 text-muted-foreground" />
              Клиент
            </h3>
            {customer ? (
              <button
                type="button"
                onClick={() => navigate(`/clients?open=${customer.id}`)}
                className="block w-full rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <div className="font-medium">{customerName(customers, request.customerId)}</div>
                <div className="text-muted-foreground">
                  {customer.phone}
                  {customer.email ? ` · ${customer.email}` : ''}
                </div>
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">Клиент не указан</p>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Car className="h-4 w-4 text-muted-foreground" />
              Автомобиль
            </h3>
            {vehicle ? (
              <div className="rounded-md border border-border p-2 text-sm">
                <div className="font-medium">{vehicleLabel(vehicles, vehicle.id)}</div>
                {(vehicle.licensePlate || vehicle.vin) && (
                  <div className="text-muted-foreground">{[vehicle.licensePlate, vehicle.vin].filter(Boolean).join(' · ')}</div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Автомобиль не указан</p>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              Услуга
            </h3>
            {service ? (
              <p className="text-sm">{serviceName(services, service.id)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Услуга не указана</p>
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              Обращение
            </h3>
            {conversationsError && <p className="text-sm text-destructive">Не удалось загрузить обращения</p>}
            {!conversationsError && conversations.length === 0 && <p className="text-sm text-muted-foreground">Обращений нет</p>}
            {conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/conversations?open=${c.id}`)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-border p-2 text-left text-sm hover:bg-muted/40"
              >
                <span className="truncate">{c.subject ?? '(без темы)'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatActivity(c.lastMessageAt ?? c.createdAt)}</span>
              </button>
            ))}
          </section>

          {request.statusHistory && request.statusHistory.length > 0 && (
            <section className="space-y-2 rounded-md border border-border p-3 lg:col-span-2">
              <h3 className="text-sm font-semibold">История статусов</h3>
              {request.statusHistory.map((h, i) => (
                <div key={i} className="text-sm text-muted-foreground">
                  {h.fromStatus ? `${REQUEST_STATUS_LABELS[h.fromStatus]} → ` : 'Создано: '}
                  {REQUEST_STATUS_LABELS[h.toStatus]} · {formatActivity(h.createdAt)}
                  {h.changedByUserName ? ` · ${h.changedByUserName}` : ''}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
