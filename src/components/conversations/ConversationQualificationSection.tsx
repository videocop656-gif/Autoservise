import { useEffect, useState, type FormEvent } from 'react'
import { ListChecks, CheckCircle2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import type { ConversationDto } from './shared'
import {
  initialForm,
  vehicleStatusText,
  serviceStatusText,
  applyBody,
  qualificationErrorMessage,
  ANALYZE_FAILED,
  APPLY_FAILED,
  type RequestQualificationDto,
  type QualificationForm,
} from './qualification'

// ---------------------------------------------------------------------------
// Prompt 55 — "Разобрать обращение" in Conversation Detail. The AI proposes a
// structured request from the conversation (POST …/qualification
// {action:"analyze"} — nothing is written); the operator reviews/corrects it
// here and only then creates the request (existing Prompt 49 bridge) or
// updates the linked one. The customer is always the conversation's linked
// customer (Prompt 54), never an AI field; vehicles and services are chosen
// from stored/configured ones only.
// ---------------------------------------------------------------------------

export interface ConversationQualificationSectionProps {
  detail: ConversationDto
  canManage: boolean
  /**
   * Called after a successful create/update with the confirmation text. The
   * parent keeps it: it reloads the conversation, which remounts this section.
   */
  onApplied: (notice: string) => void
  /** The parent-held confirmation of the last apply (survives the reload). */
  notice: string | null
}

const SELECT = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'

export function ConversationQualificationSection({ detail, canManage, onApplied, notice }: ConversationQualificationSectionProps) {
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [proposal, setProposal] = useState<RequestQualificationDto | null>(null)
  const [form, setForm] = useState<QualificationForm | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setProposal(null)
    setForm(null)
    setError(null)
  }, [detail.id])

  const hasCustomerMessage = (detail.messages ?? []).some((m) => m.direction === 'INBOUND')

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const { qualification } = await apiFetch<{ qualification: RequestQualificationDto }>(`/api/conversations/${detail.id}/qualification`, {
        method: 'POST',
        body: JSON.stringify({ action: 'analyze' }),
      })
      setProposal(qualification)
      setForm(initialForm(qualification))
    } catch (err) {
      setError(err instanceof ApiClientError ? qualificationErrorMessage('analyze', err.code, err.message) : ANALYZE_FAILED)
    } finally {
      setAnalyzing(false)
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault()
    if (!proposal || !form) return
    setSaving(true)
    setError(null)
    try {
      await apiFetch(`/api/conversations/${detail.id}/qualification`, { method: 'POST', body: JSON.stringify(applyBody(proposal, form)) })
      setProposal(null)
      setForm(null)
      onApplied(proposal.basedOn.customerRequestId ? 'Обращение обновлено.' : 'Обращение создано и связано с диалогом.')
    } catch (err) {
      setError(err instanceof ApiClientError ? qualificationErrorMessage('apply', err.code, err.message) : APPLY_FAILED)
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) return null

  const isUpdate = !!proposal?.basedOn.customerRequestId
  const noCustomer = proposal?.customer.status === 'missing'

  return (
    <section data-testid="conversation-qualification" className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Разбор обращения</h3>

      {!proposal && (
        <div className="space-y-1">
          <Button size="sm" variant="outline" onClick={() => void analyze()} disabled={analyzing || !hasCustomerMessage} aria-busy={analyzing}>
            <ListChecks className="mr-1 h-4 w-4" />
            {analyzing ? 'AI анализирует обращение…' : 'Разобрать обращение'}
          </Button>
          {!hasCustomerMessage && <p className="text-xs text-muted-foreground">В диалоге пока нет сообщений клиента.</p>}
          {hasCustomerMessage && !analyzing && (
            <p className="text-xs text-muted-foreground">AI предложит услугу, автомобиль, описание и время — вы проверите их до сохранения.</p>
          )}
        </div>
      )}

      {notice && !proposal && (
        <p className="flex items-center gap-1 text-sm text-green-600" role="status">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </p>
      )}

      {proposal && form && (
        <form onSubmit={apply} className="space-y-3 rounded-md border border-border p-3 text-sm" aria-label="Разбор обращения">
          <p className="text-xs text-muted-foreground">Предложение AI — ничего не сохранено, пока вы не подтвердите.</p>

          {/* Customer: always the conversation's linked customer */}
          <div className="space-y-1">
            <span className="text-sm font-medium">Клиент</span>
            {proposal.customer.status === 'linked' ? (
              <p>
                <span className="font-medium">{proposal.customer.name}</span> <span className="text-muted-foreground">· {proposal.customer.phone}</span>
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-amber-500">Клиент не определён — свяжите или создайте его в разделе «Клиент и автомобиль».</p>
                {(proposal.customer.mentionedName || proposal.customer.mentionedPhone) && (
                  <p className="text-xs text-muted-foreground">
                    Из сообщения (не проверено): {[proposal.customer.mentionedName, proposal.customer.mentionedPhone].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Vehicle: only the customer's stored vehicles */}
          <div className="space-y-1">
            <Label htmlFor="q-vehicle">Автомобиль</Label>
            <select id="q-vehicle" className={SELECT} value={form.vehicleId} disabled={noCustomer} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
              <option value="">Не выбран</option>
              {proposal.vehicleOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className={`text-xs ${['ambiguous', 'unverified'].includes(proposal.vehicle.status) ? 'text-amber-500' : 'text-muted-foreground'}`}>
              {vehicleStatusText(proposal.vehicle)}
            </p>
          </div>

          {/* Service: only configured services */}
          <div className="space-y-1">
            <Label htmlFor="q-service">Услуга</Label>
            <select id="q-service" className={SELECT} value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
              <option value="">Не выбрана</option>
              {proposal.serviceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.isActive ? s.name : `${s.name} (неактивна)`}
                </option>
              ))}
            </select>
            <p className={`text-xs ${proposal.service.status === 'unresolved' ? 'text-amber-500' : 'text-muted-foreground'}`}>{serviceStatusText(proposal.service)}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="q-subject">Тема</Label>
            <Input id="q-subject" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="q-description">Что нужно клиенту</Label>
            <Textarea id="q-description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>

          <div className="space-y-1">
            <span className="text-sm font-medium">Пожелание по времени</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="q-date" className="text-xs text-muted-foreground">
                  Дата
                </Label>
                <Input id="q-date" type="date" value={form.requestedDate} onChange={(e) => setForm({ ...form, requestedDate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="q-from" className="text-xs text-muted-foreground">
                  С
                </Label>
                <Input id="q-from" type="time" value={form.requestedTimeFrom} onChange={(e) => setForm({ ...form, requestedTimeFrom: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="q-to" className="text-xs text-muted-foreground">
                  До
                </Label>
                <Input id="q-to" type="time" value={form.requestedTimeTo} onChange={(e) => setForm({ ...form, requestedTimeTo: e.target.value })} />
              </div>
            </div>
            {proposal.timing.notes.map((n) => (
              <p key={n} className="text-xs text-amber-500">
                {n}
              </p>
            ))}
          </div>

          {proposal.missing.length > 0 && (
            <div className="space-y-1" aria-label="Для записи не хватает">
              <span className="text-sm font-medium">Для записи не хватает</span>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {proposal.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {proposal.needsHuman && <p className="text-xs text-amber-500">AI советует, чтобы обращение проверил администратор.</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saving || noCustomer}>
              {saving ? 'Сохранение…' : isUpdate ? 'Обновить обращение' : 'Создать обращение'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setProposal(null)
                setForm(null)
                setError(null)
              }}
            >
              Закрыть
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
