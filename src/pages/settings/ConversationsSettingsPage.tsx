import { useEffect, useState, type FormEvent } from 'react'
import {
  Plus,
  Lock,
  Unlock,
  Search,
  RefreshCw,
  AlertTriangle,
  Globe,
  Send,
  Phone,
  MessageCircle,
  HelpCircle,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { PageHeader } from '../../components/layout/PageHeader'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

// ---------------------------------------------------------------------------
// Prompt 21 — Conversations v1 (рабочий inbox), built strictly on the
// existing backend from Prompts 02/16/17. No new endpoint, no schema change.
//
// UI field -> real data source:
//   Client name      -> Conversation.customerId, resolved against
//                        GET /api/customers?pageSize=100 (same reference-
//                        data-lookup pattern as the Dashboard/Appointments
//                        pages). Falls back to "Неизвестный клиент".
//   Channel           -> Conversation.channel (real enum, GET /api/conversations)
//   Status            -> Conversation.status (OPEN/CLOSED, real enum)
//   Last activity     -> Conversation.lastMessageAt, falling back to createdAt
//   Attention         -> derived, not a stored field: a conversation is
//                        flagged when it has a currently OPEN or IN_PROGRESS
//                        AiEscalation (GET /api/escalations?status=..., the
//                        same two-call pattern the Dashboard uses because
//                        escalationStatusFilterSchema only accepts one
//                        status at a time).
//   Search            -> GET /api/conversations?search= (server-side,
//                        matches Conversation.subject only — see Known
//                        Limitations in the Final Report)
//   Message preview   -> NOT available: GET /api/conversations (list) never
//                        includes `messages` (only the single-GET detail
//                        endpoint does — see conversationRepository.ts).
//                        Fetching it per row would mean one extra request
//                        per conversation, which spec §15 explicitly
//                        forbids. Rows show metadata only.
//   AI / human state  -> no honest per-row signal exists without an extra
//                        request per row (AiInteractionLog is keyed by
//                        conversationId with no bulk-by-many-ids query), so
//                        no "AI handled" badge is shown — only the real,
//                        cheap "Требует внимания" signal above.
// ---------------------------------------------------------------------------

type ConversationChannel = 'MANUAL' | 'WEBSITE' | 'TELEGRAM' | 'WHATSAPP' | 'PHONE' | 'OTHER'
type ConversationStatus = 'OPEN' | 'CLOSED'
type MessageDirection = 'INBOUND' | 'OUTBOUND'
type MessageSenderType = 'CUSTOMER' | 'STAFF' | 'SYSTEM'
type EscalationStatus = 'OPEN' | 'IN_PROGRESS'
type EscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

type ChannelDeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'

interface ChannelDeliveryDto {
  id: string
  messageId: string
  channelConnectionId: string
  status: ChannelDeliveryStatus
  attemptCount: number
  externalMessageId: string | null
  lastAttemptAt: string | null
  sentAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

interface MessageDto {
  id: string
  conversationId: string
  direction: MessageDirection
  senderType: MessageSenderType
  content: string
  createdAt: string
  // Channel Operations & Delivery Foundation (Prompt 17) — present only once a send through a channel has been attempted for this message.
  delivery?: ChannelDeliveryDto
}

interface ConversationDto {
  id: string
  customerId: string | null
  customerRequestId: string | null
  channel: ConversationChannel
  status: ConversationStatus
  subject: string | null
  startedAt: string
  lastMessageAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  // Prompt 17 — null for a manually-created conversation; set for one linked to a real ChannelConnection (Prompt 16).
  channelConnectionId: string | null
  customer?: { id: string; firstName: string; lastName: string | null } | null
  customerRequest?: { id: string; subject: string; status: string } | null
  messages?: MessageDto[]
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
}
interface CustomerRequestDto {
  id: string
  subject: string
  customerId: string
}
interface EscalationLiteDto {
  conversationId: string
  priority: EscalationPriority
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface CreateFormState {
  customerId: string
  customerRequestId: string
  channel: ConversationChannel
  subject: string
}

const EMPTY_CREATE_FORM: CreateFormState = {
  customerId: '',
  customerRequestId: '',
  channel: 'MANUAL',
  subject: '',
}

const STATUSES: ConversationStatus[] = ['OPEN', 'CLOSED']
const CHANNELS: ConversationChannel[] = ['MANUAL', 'WEBSITE', 'TELEGRAM', 'WHATSAPP', 'PHONE', 'OTHER']

const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Открыт',
  CLOSED: 'Закрыт',
}

const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  MANUAL: 'Вручную',
  WEBSITE: 'Сайт',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Телефон',
  OTHER: 'Другое',
}

const CHANNEL_ICONS: Record<ConversationChannel, LucideIcon> = {
  MANUAL: UserRound,
  WEBSITE: Globe,
  TELEGRAM: Send,
  WHATSAPP: MessageCircle,
  PHONE: Phone,
  OTHER: HelpCircle,
}

/** 300ms debounce on the search box only — avoids firing a request on every keystroke while still using the real server-side `search` param (spec §6). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

/** "5 мин назад" for very recent activity, "Сегодня/Вчера, HH:MM" for today/yesterday, else an absolute short date — one consistent format across every row (spec §14). */
function formatActivity(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин назад`

  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (date.toDateString() === now.toDateString()) return `Сегодня, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Вчера, ${time}`
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

export default function ConversationsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'

  const [data, setData] = useState<Paginated<ConversationDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customerRequests, setCustomerRequests] = useState<CustomerRequestDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | ''>('')
  const [channelFilter, setChannelFilter] = useState<ConversationChannel | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 300)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Attention signal — derived from currently OPEN/IN_PROGRESS escalations,
  // exactly like the Dashboard's own "Требует внимания" block. Non-fatal:
  // if it fails to load, rows simply show no attention badge and the
  // "Требует внимания" filter is hidden, without blocking the rest of the page.
  const [attentionMap, setAttentionMap] = useState<Map<string, EscalationPriority>>(new Map())
  const [attentionAvailable, setAttentionAvailable] = useState(true)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDto | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [messageContent, setMessageContent] = useState('')
  const [messageDirection, setMessageDirection] = useState<MessageDirection>('OUTBOUND')
  const [messageSenderType, setMessageSenderType] = useState<MessageSenderType>('STAFF')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [channelSendError, setChannelSendError] = useState<string | null>(null)
  const [channelSendingId, setChannelSendingId] = useState<string | null>(null)

  function customerLabel(id: string | null): string {
    if (!id) return 'Неизвестный клиент'
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : 'Неизвестный клиент'
  }

  async function loadReferenceData() {
    try {
      const [customersResult, requestsResult] = await Promise.all([
        apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<CustomerRequestDto>>('/api/customer-requests?pageSize=100'),
      ])
      setCustomers(customersResult.items)
      setCustomerRequests(requestsResult.items)
    } catch {
      // Non-fatal: the conversation list still works, just falls back to "Неизвестный клиент".
    }
  }

  async function loadAttention() {
    try {
      const [open, inProgress] = await Promise.all([
        apiFetch<Paginated<EscalationLiteDto>>('/api/escalations?status=OPEN&pageSize=100'),
        apiFetch<Paginated<EscalationLiteDto>>('/api/escalations?status=IN_PROGRESS&pageSize=100'),
      ])
      const map = new Map<string, EscalationPriority>()
      for (const e of [...open.items, ...inProgress.items]) map.set(e.conversationId, e.priority)
      setAttentionMap(map)
      setAttentionAvailable(true)
    } catch {
      setAttentionMap(new Map())
      setAttentionAvailable(false)
    }
  }

  async function loadConversations() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      // The "Требует внимания" filter has no server-side equivalent (a
      // Conversation<->AiEscalation join isn't exposed by any existing
      // endpoint — see spec §7/§31, "не создавай новую бизнес-логику").
      // Rather than invent one, we fetch the largest allowed page (the
      // backend's own pageSize cap, not an arbitrary number we chose) and
      // filter it client-side against the attention set below; normal
      // pagination is used otherwise.
      params.set('page', attentionOnly ? '1' : String(page))
      params.set('pageSize', attentionOnly ? '100' : '20')
      if (statusFilter) params.set('status', statusFilter)
      if (channelFilter) params.set('channel', channelFilter)
      if (search.trim()) params.set('search', search.trim())
      const result = await apiFetch<Paginated<ConversationDto>>(`/api/conversations?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить обращения.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
    void loadAttention()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    void loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, channelFilter, search, attentionOnly, refreshKey])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, channelFilter, search, attentionOnly])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  function resetFilters() {
    setStatusFilter('')
    setChannelFilter('')
    setSearchInput('')
    setAttentionOnly(false)
  }

  const hasActiveFilters = statusFilter !== '' || channelFilter !== '' || searchInput.trim() !== '' || attentionOnly

  const visibleItems = attentionOnly ? (data?.items.filter((c) => attentionMap.has(c.id)) ?? []) : (data?.items ?? [])

  async function loadDetail(id: string) {
    setDetailError(null)
    try {
      const result = await apiFetch<{ conversation: ConversationDto }>(`/api/conversations/${id}`)
      setDetail(result.conversation)
    } catch {
      setDetailError('Не удалось загрузить разговор.')
    }
  }

  function openDetail(id: string) {
    setOpenId(id)
    setDetail(null)
    setSendError(null)
    void loadDetail(id)
  }

  function closeDetail() {
    setOpenId(null)
    setDetail(null)
  }

  function openCreateForm() {
    setCreateForm(EMPTY_CREATE_FORM)
    setCreateError(null)
    setCreateFieldErrors({})
    setShowCreateForm(true)
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateFieldErrors({})
    setSaving(true)
    try {
      await apiFetch('/api/conversations', {
        method: 'POST',
        body: JSON.stringify({
          customerId: createForm.customerId === '' ? null : createForm.customerId,
          customerRequestId: createForm.customerRequestId === '' ? null : createForm.customerRequestId,
          channel: createForm.channel,
          subject: createForm.subject === '' ? null : createForm.subject,
        }),
      })
      setShowCreateForm(false)
      await loadConversations()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message || 'Проверьте заполненные поля.')
        setCreateFieldErrors(err.fieldErrors)
      } else {
        setCreateError('Не удалось создать разговор.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus() {
    if (!detail) return
    const nextStatus: ConversationStatus = detail.status === 'OPEN' ? 'CLOSED' : 'OPEN'
    try {
      await apiFetch(`/api/conversations/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) })
      await loadDetail(detail.id)
      await loadConversations()
    } catch (err) {
      setDetailError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    }
  }

  // Channel Operations & Delivery Foundation (Prompt 17) — minimal
  // operational action only: send one already-existing OUTBOUND/STAFF
  // message through the conversation's own ChannelConnection. No AI send
  // button, no auto-reply, no new messaging surface.
  async function handleSendViaChannel(messageId: string) {
    if (!detail?.channelConnectionId) return
    setChannelSendError(null)
    setChannelSendingId(messageId)
    try {
      await apiFetch(`/api/channels/${detail.channelConnectionId}/messages/${messageId}/send`, { method: 'POST' })
      await loadDetail(detail.id)
    } catch (err) {
      setChannelSendError(err instanceof ApiClientError ? err.message : 'Не удалось отправить сообщение через канал.')
    } finally {
      setChannelSendingId(null)
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    if (!detail) return
    setSendError(null)
    setSending(true)
    try {
      await apiFetch(`/api/conversations/${detail.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ direction: messageDirection, senderType: messageSenderType, content: messageContent }),
      })
      setMessageContent('')
      await loadDetail(detail.id)
      await loadConversations()
    } catch (err) {
      setSendError(err instanceof ApiClientError ? err.message : 'Не удалось отправить сообщение.')
    } finally {
      setSending(false)
    }
  }

  function attentionBadgeVariant(priority: EscalationPriority): 'destructive' | 'warning' | 'gold' {
    if (priority === 'URGENT') return 'destructive'
    if (priority === 'HIGH') return 'warning'
    return 'gold'
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader
        title="Обращения"
        subtitle="Все обращения клиентов в одном месте"
        actions={
          canManage ? (
            <Button size="sm" onClick={openCreateForm}>
              <Plus className="mr-1 h-4 w-4" />
              Новый разговор
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по теме..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 pl-9"
                aria-label="Поиск обращений по теме"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ConversationStatus | '')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по статусу"
            >
              <option value="">Все статусы</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as ConversationChannel | '')}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Фильтр по каналу"
            >
              <option value="">Все каналы</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
            {attentionAvailable && (
              <Button
                type="button"
                variant={attentionOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAttentionOnly((v) => !v)}
                aria-pressed={attentionOnly}
              >
                <AlertTriangle className="mr-1 h-4 w-4" />
                Требует внимания
              </Button>
            )}
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

          {!loading && !listError && data && visibleItems.length === 0 && !hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Обращений пока нет</p>
              <p className="mt-1 text-sm text-muted-foreground">Новые обращения клиентов появятся здесь автоматически.</p>
            </div>
          )}

          {!loading && !listError && data && visibleItems.length === 0 && hasActiveFilters && (
            <div className="rounded-md border border-border py-8 text-center">
              <p className="text-sm font-medium">Ничего не найдено</p>
              <p className="mt-1 text-sm text-muted-foreground">Попробуйте изменить параметры поиска или фильтра.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          )}

          {!loading &&
            !listError &&
            visibleItems.map((conv) => {
              const ChannelIcon = CHANNEL_ICONS[conv.channel]
              const priority = attentionMap.get(conv.id)
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => openDetail(conv.id)}
                  className="flex w-full items-start justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <ChannelIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{customerLabel(conv.customerId)}</div>
                      {conv.subject && <div className="truncate text-sm text-muted-foreground">{conv.subject}</div>}
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span>{CHANNEL_LABELS[conv.channel]}</span>
                        <span>·</span>
                        <span>{formatActivity(conv.lastMessageAt ?? conv.createdAt)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant={conv.status === 'OPEN' ? 'success' : 'default'}>{STATUS_LABELS[conv.status]}</Badge>
                    {priority && <Badge variant={attentionBadgeVariant(priority)}>Требует внимания</Badge>}
                  </div>
                </button>
              )
            })}

          {!attentionOnly && data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          {attentionOnly && data && data.total > 100 && (
            <p className="pt-1 text-center text-xs text-muted-foreground">
              Показаны совпадения среди первых 100 обращений (по выбранным фильтрам).
            </p>
          )}
        </CardContent>
      </Card>

      {showCreateForm && canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Новый разговор</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="conv-customer">Клиент (опционально)</Label>
                  <select
                    id="conv-customer"
                    value={createForm.customerId}
                    onChange={(e) => setCreateForm({ ...createForm, customerId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="">Не определён</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conv-request">Заявка клиента (опционально)</Label>
                  <select
                    id="conv-request"
                    value={createForm.customerRequestId}
                    onChange={(e) => setCreateForm({ ...createForm, customerRequestId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="">Нет</option>
                    {customerRequests
                      .filter((r) => createForm.customerId === '' || r.customerId === createForm.customerId)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.subject}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="conv-channel">Канал</Label>
                  <select
                    id="conv-channel"
                    value={createForm.channel}
                    onChange={(e) => setCreateForm({ ...createForm, channel: e.target.value as ConversationChannel })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conv-subject">Тема (опционально)</Label>
                  <Input
                    id="conv-subject"
                    value={createForm.subject}
                    onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
                  />
                  {createFieldErrors.subject && <p className="text-sm text-destructive">{createFieldErrors.subject[0]}</p>}
                </div>
              </div>

              {createError && <p className="text-sm text-destructive">{createError}</p>}

              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Сохранение...' : 'Сохранить'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {openId && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="min-w-0">
              <CardTitle className="truncate">{detail?.subject ?? '(без темы)'}</CardTitle>
              <CardDescription>
                {detail ? `${CHANNEL_LABELS[detail.channel]} · ${customerLabel(detail.customerId)}` : 'Загрузка...'}
                {detail?.customerRequest ? ` · заявка: ${detail.customerRequest.subject}` : ''}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {detail && canManage && (
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
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                Закрыть панель
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {detailError && <p className="text-sm text-destructive">{detailError}</p>}
            {!detail && !detailError && <p className="text-sm text-muted-foreground">Загрузка...</p>}

            {detail && (
              <>
                <div className="space-y-2 rounded-md border p-3">
                  {detail.messages?.length === 0 && <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>}
                  {detail.messages?.map((m) => {
                    const canSendViaChannel = !!detail.channelConnectionId && m.direction === 'OUTBOUND' && m.senderType === 'STAFF'
                    return (
                      <div key={m.id} className={`rounded-md p-2 text-sm ${m.direction === 'INBOUND' ? 'bg-muted' : 'bg-accent'}`}>
                        <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{m.direction}</span>
                          <span>·</span>
                          <span>{m.senderType}</span>
                          <span>·</span>
                          <span>{new Date(m.createdAt).toLocaleString()}</span>
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
                    )
                  })}
                  {channelSendError && <p className="text-sm text-destructive">{channelSendError}</p>}
                </div>

                {canManage && (
                  <form onSubmit={handleSendMessage} className="space-y-3">
                    <Textarea
                      placeholder="Текст сообщения..."
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      required
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={messageDirection}
                        onChange={(e) => setMessageDirection(e.target.value as MessageDirection)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="INBOUND">INBOUND</option>
                        <option value="OUTBOUND">OUTBOUND</option>
                      </select>
                      <select
                        value={messageSenderType}
                        onChange={(e) => setMessageSenderType(e.target.value as MessageSenderType)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="CUSTOMER">CUSTOMER</option>
                        <option value="STAFF">STAFF</option>
                        <option value="SYSTEM">SYSTEM</option>
                      </select>
                      <Button type="submit" size="sm" disabled={sending}>
                        {sending ? 'Отправка...' : 'Отправить'}
                      </Button>
                    </div>
                    {sendError && <p className="text-sm text-destructive">{sendError}</p>}
                    {detail.status === 'CLOSED' && (
                      <p className="text-sm text-muted-foreground">Разговор закрыт — сначала откройте его заново.</p>
                    )}
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}
