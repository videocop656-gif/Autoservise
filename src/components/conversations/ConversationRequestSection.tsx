import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import {
  type ConversationDto,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  CHANNEL_LABELS,
  REQUEST_STATUS_LABELS,
  customerName,
  vehicleLabel,
  serviceName,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 49 — «Обращение» block of Conversation Detail: the operational
// bridge Conversation → CustomerRequest.
//
//   State B (linked): «Обращение создано» + status/vehicle/service/date and
//     «Открыть обращение» → the existing /requests?open= detail. Derived from
//     the conversation's own customerRequest summary (API), never from a
//     capped client-side reference list, so a linked request is always shown
//     and a second create action is never offered — whatever its status.
//   State A (not linked): helper copy + «Создать обращение» → an inline,
//     pre-filled form the operator reviews and edits before creating.
//     Pre-fill is deterministic only (no AI): the conversation's customer,
//     the customer's single vehicle if unambiguous, the conversation subject,
//     and the latest inbound customer message as the description.
// The server (POST /api/conversations/:id/request) is idempotent; the
// disabled button while saving is UX only.
// ---------------------------------------------------------------------------

interface ConversationRequestSectionProps {
  detail: ConversationDto
  canManage: boolean
  customers: (CustomerRefDto & { isActive?: boolean })[]
  vehicles: VehicleRefDto[]
  services: (ServiceRefDto & { isActive?: boolean })[]
  /** Called after a successful create — the panel reloads the conversation. */
  onCreated: () => void
}

interface FormState {
  customerId: string
  vehicleId: string
  serviceId: string
  subject: string
  description: string
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

export function ConversationRequestSection({ detail, canManage, customers, vehicles, services, onCreated }: ConversationRequestSectionProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const linked = detail.customerRequest ?? null
  const hasLinkedRequest = !!detail.customerRequestId

  function vehiclesOf(customerId: string) {
    return vehicles.filter((v) => v.customerId === customerId)
  }

  function startCreate() {
    const customerId = detail.customerId ?? ''
    const ownVehicles = customerId ? vehiclesOf(customerId) : []
    const lastCustomerMessage = [...(detail.messages ?? [])].reverse().find((m) => m.senderType === 'CUSTOMER' && m.content.trim())
    setForm({
      customerId,
      vehicleId: ownVehicles.length === 1 ? ownVehicles[0]!.id : '',
      serviceId: '',
      subject: detail.subject?.trim() || `Обращение из диалога (${CHANNEL_LABELS[detail.channel]})`,
      description: lastCustomerMessage?.content ?? '',
    })
    setFormError(null)
    setFieldErrors({})
    setOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form || saving) return
    if (!form.customerId) {
      setFieldErrors({ customerId: ['Клиент не выбран'] })
      return
    }
    setSaving(true)
    setFormError(null)
    setFieldErrors({})
    try {
      await apiFetch(`/api/conversations/${detail.id}/request`, {
        method: 'POST',
        body: JSON.stringify({
          customerId: detail.customerId ? undefined : form.customerId,
          vehicleId: form.vehicleId || null,
          serviceId: form.serviceId || null,
          subject: form.subject,
          description: form.description || null,
        }),
      })
      setOpen(false)
      onCreated()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fieldErrors)
        setFormError(err.code === 'VALIDATION_ERROR' && Object.keys(err.fieldErrors).length > 0 ? 'Проверьте заполненные поля.' : err.message || 'Не удалось создать обращение.')
      } else {
        setFormError('Не удалось создать обращение.')
      }
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (name: keyof FormState) =>
    fieldErrors[name]?.[0] ? <p className="text-xs text-destructive">{fieldErrors[name]![0]}</p> : null

  // ---- State B: a request is linked ----
  if (hasLinkedRequest) {
    const requestId = detail.customerRequestId!
    return (
      <section data-testid="conversation-request">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Обращение</h3>
        <div className="mt-1 space-y-1 text-sm">
          <div className="font-medium text-success">Обращение создано</div>
          {linked && <div className="font-medium">{linked.subject}</div>}
          {linked && <div className="text-muted-foreground">Статус: {REQUEST_STATUS_LABELS[linked.status as keyof typeof REQUEST_STATUS_LABELS] ?? linked.status}</div>}
          {linked?.vehicleId && <div className="text-muted-foreground">Автомобиль: {vehicleLabel(vehicles, linked.vehicleId) ?? '—'}</div>}
          {linked?.serviceId && <div className="text-muted-foreground">Услуга: {serviceName(services, linked.serviceId) ?? '—'}</div>}
          {linked?.createdAt && <div className="text-muted-foreground">Создано: {formatDate(linked.createdAt)}</div>}
          <Button size="sm" variant="outline" className="mt-1" onClick={() => navigate(`/requests?open=${requestId}`)}>
            Открыть обращение
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </section>
    )
  }

  // ---- State A: no request yet ----
  const activeCustomers = customers.filter((c) => c.isActive !== false)
  const activeServices = services.filter((s) => s.isActive !== false)
  const customerVehicles = form?.customerId ? vehiclesOf(form.customerId) : []

  return (
    <section data-testid="conversation-request">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Обращение</h3>
      {!open && (
        <div className="mt-1 space-y-2 text-sm">
          <p className="text-muted-foreground">Создайте обращение, чтобы продолжить работу с клиентом: запись, обслуживание и история.</p>
          {canManage ? (
            <Button size="sm" onClick={startCreate}>
              <Plus className="mr-1 h-4 w-4" />
              Создать обращение
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Создавать обращения могут владелец, администратор и менеджер.</p>
          )}
        </div>
      )}

      {open && form && (
        <form onSubmit={handleSubmit} className="mt-2 space-y-3 rounded-md border border-border p-3 text-sm" aria-label="Новое обращение из диалога">
          <div className="space-y-1">
            <Label htmlFor="cr-customer">Клиент</Label>
            {detail.customerId ? (
              <p id="cr-customer" className="font-medium">{customerName(customers, detail.customerId)}</p>
            ) : (
              <>
                <select
                  id="cr-customer"
                  required
                  value={form.customerId}
                  onChange={(e) => {
                    const own = vehiclesOf(e.target.value)
                    setForm({ ...form, customerId: e.target.value, vehicleId: own.length === 1 ? own[0]!.id : '' })
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Выберите клиента…</option>
                  {activeCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`${c.firstName} ${c.lastName ?? ''}`.trim()} · {c.phone}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Клиента нет в списке?{' '}
                  <Link to="/clients" className="underline underline-offset-2">
                    Создайте его в разделе «Клиенты»
                  </Link>
                  , затем вернитесь к диалогу.
                </p>
              </>
            )}
            {fieldError('customerId')}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cr-vehicle">Автомобиль</Label>
            <select
              id="cr-vehicle"
              value={form.vehicleId}
              disabled={!form.customerId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Не указан</option>
              {customerVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleLabel(vehicles, v.id)}
                  {v.licensePlate ? ` · ${v.licensePlate}` : ''}
                </option>
              ))}
            </select>
            {fieldError('vehicleId')}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cr-service">Услуга</Label>
            <select
              id="cr-service"
              value={form.serviceId}
              onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Не указана</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {fieldError('serviceId')}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cr-subject">Тема</Label>
            <Input id="cr-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            {fieldError('subject')}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cr-description">Описание</Label>
            <Textarea id="cr-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <p className="text-xs text-muted-foreground">Подставлено последнее сообщение клиента — можно изменить.</p>
            {fieldError('description')}
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Создание…' : 'Создать обращение'}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
