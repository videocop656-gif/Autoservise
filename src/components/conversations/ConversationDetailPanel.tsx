import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, Lock, Unlock, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import {
  type ConversationDto,
  type MessageDto,
  type EscalationDto,
  type AiLogDto,
  type CustomerRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type CustomerRequestRefDto,
  type Paginated,
  STATUS_LABELS,
  CHANNEL_LABELS,
  ESCALATION_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  attentionBadgeVariant,
  isActiveEscalation,
  customerName,
  vehicleLabel,
  serviceName,
  formatActivity,
  aiLogSummary,
} from './shared'

// ---------------------------------------------------------------------------
// Prompt 22 — Conversation Detail v1.
//
// Architecture: the existing Conversations screen (Prompt 21) already
// opened conversation detail inline, within the same /conversations route
// — no separate `/conversation/:id` route existed, and none is created
// here either (spec §2). This component is that same inline detail,
// rebuilt into a real operational screen: when a conversation is open,
// ConversationsSettingsPage renders ONLY this panel (full width, with its
// own "Назад к обращениям" back action) instead of stacking it below the
// list — matching spec §4's full-screen layout intent without adding a
// route.
//
// Data sources (spec §23's "map before coding"):
//   Header/thread/status/close-reopen -> GET /api/conversations/:id
//     (unchanged — already returns customer/customerRequest summaries and
//     the full message list with per-message ChannelDelivery).
//   Attention/Escalation               -> GET /api/escalations?conversationId=
//     (existing filter, already supported by escalation.schemas.ts/the
//     escalation route — confirmed by audit, not assumed).
//   AI status                          -> GET /api/ai-logs?conversationId=
//     (existing filter; the most recent real AiLog row for this
//     conversation, if any — never invented, and omitted entirely when
//     none exists, per spec §13).
//   Customer/Vehicle/Request/Service   -> the SAME reference-data arrays
//     (customers/vehicles/services/customerRequests, each fetched once by
//     the parent at pageSize=100) already used by the inbox for name
//     resolution — passed down as props, not re-fetched here. Zero extra
//     requests for the context panel beyond what the page already loads.
//
// All three conversation-scoped fetches (detail/escalation/ai-log) run in
// parallel via Promise.allSettled — never nested, never per-message, never
// inside a .map() (spec §14). This is a detail view for exactly one
// conversation, not a list, so a small fixed number of parallel requests
// here is not an N+1 pattern.
// ---------------------------------------------------------------------------

export interface ConversationDetailPanelProps {
  conversationId: string
  canManage: boolean
  customers: CustomerRefDto[]
  vehicles: VehicleRefDto[]
  services: ServiceRefDto[]
  customerRequests: CustomerRequestRefDto[]
  onBack: () => void
  /** Tell the parent list to refresh (e.g. lastMessageAt / status changed). */
  onChanged: () => void
}

export function ConversationDetailPanel({
  conversationId,
  canManage,
  customers,
  vehicles,
  services,
  customerRequests,
  onBack,
  onChanged,
}: ConversationDetailPanelProps) {
  const [detail, setDetail] = useState<ConversationDto | null>(null)
  const [escalation, setEscalation] = useState<EscalationDto | null>(null)
  const [aiLog, setAiLog] = useState<AiLogDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [messageContent, setMessageContent] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [channelSendError, setChannelSendError] = useState<string | null>(null)
  const [channelSendingId, setChannelSendingId] = useState<string | null>(null)

  async function loadAll() {
    setLoading(true)
    setError(null)
    const [conversationResult, escalationResult, aiLogResult] = await Promise.allSettled([
      apiFetch<{ conversation: ConversationDto }>(`/api/conversations/${conversationId}`),
      apiFetch<Paginated<EscalationDto>>(`/api/escalations?conversationId=${conversationId}&pageSize=5`),
      apiFetch<Paginated<AiLogDto>>(`/api/ai-logs?conversationId=${conversationId}&pageSize=1`),
    ])

    if (conversationResult.status === 'fulfilled') {
      setDetail(conversationResult.value.conversation)
    } else {
      setError('Не удалось загрузить обращение.')
    }
    // Escalation/AI-log are context, not the primary record — a failure
    // here just means those context-panel sections stay empty, same
    // non-fatal convention as the customer/vehicle reference-data fetches.
    setEscalation(escalationResult.status === 'fulfilled' ? (escalationResult.value.items[0] ?? null) : null)
    setAiLog(aiLogResult.status === 'fulfilled' ? (aiLogResult.value.items[0] ?? null) : null)
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  async function handleToggleStatus() {
    if (!detail) return
    const nextStatus = detail.status === 'OPEN' ? 'CLOSED' : 'OPEN'
    setStatusError(null)
    try {
      await apiFetch(`/api/conversations/${conversationId}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) })
      await loadAll()
      onChanged()
    } catch (err) {
      setStatusError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  // Existing per-message channel-delivery retry (Prompt 17/21) — preserved
  // exactly, used both standalone (older messages) and as the fallback
  // affordance if the composer's own auto-send-via-channel step (below)
  // fails.
  async function handleSendViaChannel(messageId: string) {
    if (!detail?.channelConnectionId) return
    setChannelSendError(null)
    setChannelSendingId(messageId)
    try {
      await apiFetch(`/api/channels/${detail.channelConnectionId}/messages/${messageId}/send`, { method: 'POST' })
      await loadAll()
    } catch (err) {
      setChannelSendError(err instanceof ApiClientError ? err.message : 'Не удалось отправить сообщение через канал.')
    } finally {
      setChannelSendingId(null)
    }
  }

  // Composer (spec §10-11): a single "reply as staff" action, not the old
  // manual direction/senderType picker — an admin operational screen only
  // ever needs "send my reply", and OUTBOUND/STAFF is exactly that. Still
  // the exact same existing message-creation endpoint, and still routed
  // through the existing Conversation -> channelMessageService ->
  // channelDeliveryService -> ChannelAdapter -> Telegram pipeline, never a
  // direct Telegram call from the frontend (spec §10's critical rule): if
  // the conversation has a channel connection, the newly-created message is
  // immediately handed to the SAME existing send endpoint used by the
  // per-message "Отправить через канал" button below — just chained
  // automatically instead of requiring a second click for the common case.
  // If that second call fails, the message itself was still created
  // successfully; its own row keeps the existing retry affordance.
  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!detail || detail.status !== 'OPEN' || !messageContent.trim()) return
    setSendError(null)
    setSending(true)
    try {
      const result = await apiFetch<{ message: MessageDto }>(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'OUTBOUND', senderType: 'STAFF', content: messageContent.trim() }),
      })
      setMessageContent('')
      if (detail.channelConnectionId) {
        try {
          await apiFetch(`/api/channels/${detail.channelConnectionId}/messages/${result.message.id}/send`, { method: 'POST' })
        } catch {
          // Non-fatal — see comment above.
        }
      }
      await loadAll()
      onChanged()
    } catch (err) {
      setSendError(err instanceof ApiClientError ? err.message : 'Не удалось отправить сообщение.')
    } finally {
      setSending(false)
    }
  }

  const customer = detail?.customerId ? customers.find((c) => c.id === detail.customerId) : undefined
  const request = detail?.customerRequestId ? customerRequests.find((r) => r.id === detail.customerRequestId) : undefined
  const vehicle = request?.vehicleId ? vehicles.find((v) => v.id === request.vehicleId) : undefined
  const service = request?.serviceId ? services.find((s) => s.id === request.serviceId) : undefined
  const escalationActive = escalation ? isActiveEscalation(escalation.status) : false

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Назад к обращениям
        </Button>
        {detail && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={detail.status === 'OPEN' ? 'success' : 'default'}>{STATUS_LABELS[detail.status]}</Badge>
            {escalationActive && escalation && (
              <Badge variant={attentionBadgeVariant(escalation.priority)}>
                <AlertTriangle className="h-3 w-3" />
                Требует внимания
              </Badge>
            )}
            {canManage && (
              <Button variant="outline" size="sm" onClick={handleToggleStatus}>
                {detail.status === 'OPEN' ? (
                  <>
                    <Lock className="mr-1 h-4 w-4" />
                    Закрыть
                  </>
                ) : (
                  <>
                    <Unlock className="mr-1 h-4 w-4" />
                    Открыть заново
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>
      {detail && (
        <div className="border-b border-border px-4 py-3">
          <div className="truncate text-lg font-semibold">{customerName(customers, detail.customerId)}</div>
          <p className="truncate text-sm text-muted-foreground">
            {detail.subject ?? '(без темы)'} · {CHANNEL_LABELS[detail.channel]}
          </p>
          {statusError && <p className="mt-1 text-sm text-destructive">{statusError}</p>}
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
      {!loading && !error && detail && (
        <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)_auto]">
          {/* Message thread */}
          <div className="space-y-3 border-b border-border p-4 lg:col-start-1 lg:row-start-1 lg:max-h-[60vh] lg:overflow-y-auto lg:border-b-0 lg:border-r">
            {detail.messages?.length === 0 && <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>}
            {detail.messages?.map((m) => {
              const canSendViaChannel = !!detail.channelConnectionId && m.direction === 'OUTBOUND' && m.senderType === 'STAFF'
              const alignment = m.senderType === 'STAFF' ? 'justify-end' : m.senderType === 'SYSTEM' ? 'justify-center' : 'justify-start'
              const bubble =
                m.senderType === 'STAFF'
                  ? 'bg-card border border-border'
                  : m.senderType === 'SYSTEM'
                    ? 'border border-dashed border-border bg-transparent text-xs text-muted-foreground'
                    : 'bg-muted'
              const senderLabel = m.senderType === 'CUSTOMER' ? 'Клиент' : m.senderType === 'STAFF' ? 'Сотрудник' : 'Система'
              return (
                <div key={m.id} className={`flex ${alignment}`}>
                  <div className={`max-w-[85%] rounded-lg p-3 text-sm ${bubble}`}>
                    <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{senderLabel}</span>
                      <span>·</span>
                      <span>{formatActivity(m.createdAt)}</span>
                    </div>
                    <div>{m.content}</div>
                    {canSendViaChannel && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        {m.delivery && (
                          <Badge variant={m.delivery.status === 'SENT' ? 'success' : m.delivery.status === 'FAILED' ? 'destructive' : 'default'}>
                            {m.delivery.status} · попыток: {m.delivery.attemptCount}
                          </Badge>
                        )}
                        {canManage && m.delivery?.status !== 'SENT' && m.delivery?.status !== 'SENDING' && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={channelSendingId === m.id}
                            onClick={() => handleSendViaChannel(m.id)}
                          >
                            {channelSendingId === m.id
                              ? 'Отправка...'
                              : m.delivery?.status === 'FAILED'
                                ? 'Повторить отправку'
                                : 'Отправить через канал'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {channelSendError && <p className="text-sm text-destructive">{channelSendError}</p>}
          </div>

          {/* Composer */}
          <div className="border-t border-border p-4 lg:col-span-2 lg:row-start-2">
            {canManage && detail.status === 'OPEN' && (
              <form onSubmit={handleSend} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Textarea
                  placeholder="Введите сообщение..."
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  className="min-h-[2.5rem] flex-1"
                  aria-label="Текст сообщения"
                />
                <Button type="submit" disabled={sending || !messageContent.trim()}>
                  {sending ? 'Отправка...' : 'Отправить'}
                </Button>
              </form>
            )}
            {canManage && detail.status === 'CLOSED' && (
              <p className="text-sm text-muted-foreground">Разговор закрыт — сначала откройте его заново, чтобы ответить.</p>
            )}
            {!canManage && <p className="text-sm text-muted-foreground">У вас нет прав для отправки сообщений.</p>}
            {sendError && <p className="mt-2 text-sm text-destructive">{sendError}</p>}
          </div>

          {/* Context panel */}
          <div className="space-y-4 border-b border-border p-4 lg:col-start-2 lg:row-start-1 lg:max-h-[60vh] lg:overflow-y-auto lg:border-b-0">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Клиент</h3>
              {customer ? (
                <div className="mt-1 space-y-0.5 text-sm">
                  <div className="font-medium">{customerName(customers, detail.customerId)}</div>
                  {customer.phone && <div className="text-muted-foreground">{customer.phone}</div>}
                  {customer.email && <div className="text-muted-foreground">{customer.email}</div>}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Клиент не определён</p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Автомобиль</h3>
              {vehicle ? (
                <div className="mt-1 text-sm">
                  <div className="font-medium">{vehicleLabel(vehicles, vehicle.id)}</div>
                  {(vehicle.licensePlate || vehicle.vin) && (
                    <div className="text-muted-foreground">{[vehicle.licensePlate, vehicle.vin].filter(Boolean).join(' · ')}</div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Автомобиль не указан</p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Заявка</h3>
              {request ? (
                <div className="mt-1 space-y-0.5 text-sm">
                  <div className="font-medium">{request.subject}</div>
                  {service && <div className="text-muted-foreground">Услуга: {serviceName(services, service.id)}</div>}
                  <div className="text-muted-foreground">Статус: {REQUEST_STATUS_LABELS[request.status]}</div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Заявка не связана</p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Эскалация</h3>
              {escalation ? (
                <div className="mt-1 space-y-1 text-sm">
                  <Badge variant={attentionBadgeVariant(escalation.priority)}>{ESCALATION_STATUS_LABELS[escalation.status]}</Badge>
                  <p className="text-muted-foreground">{escalation.reason}</p>
                  {escalation.summary && <p className="text-muted-foreground">{escalation.summary}</p>}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Эскалаций не было</p>
              )}
            </section>

            {aiLog && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI</h3>
                <div className="mt-1 space-y-0.5 text-sm">
                  <div>{aiLogSummary(aiLog)}</div>
                  {aiLog.intent && <div className="text-muted-foreground">Намерение: {aiLog.intent}</div>}
                  <div className="text-xs text-muted-foreground">{formatActivity(aiLog.createdAt)}</div>
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
