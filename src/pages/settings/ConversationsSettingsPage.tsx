import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, RefreshCw, AlertTriangle } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { PageHeader } from '../../components/layout/PageHeader'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardHeader } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { ConversationDetailPanel } from '../../components/conversations/ConversationDetailPanel'
import {
  type ConversationChannel,
  type ConversationStatus,
  type ConversationDto,
  type CustomerRefDto,
  type CustomerRequestRefDto,
  type VehicleRefDto,
  type ServiceRefDto,
  type EscalationDto,
  type EscalationPriority,
  type Paginated,
  STATUS_LABELS,
  CHANNEL_LABELS,
  CHANNEL_ICONS,
  customerName,
  attentionBadgeVariant,
  formatActivity,
} from '../../components/conversations/shared'

// ---------------------------------------------------------------------------
// Prompt 21/22 — Conversations Inbox + Conversation Detail v1, built
// strictly on the existing backend from Prompts 02/16/17. No new endpoint,
// no schema change. Shared types/labels/helpers live in
// components/conversations/shared.ts, reused by both this inbox and the
// ConversationDetailPanel opened below.
// ---------------------------------------------------------------------------

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

/** 300ms debounce on the search box only — avoids firing a request on every keystroke while still using the real server-side `search` param (spec §6). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

export default function ConversationsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'

  const [data, setData] = useState<Paginated<ConversationDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerRefDto[]>([])
  const [customerRequests, setCustomerRequests] = useState<CustomerRequestRefDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleRefDto[]>([])
  const [services, setServices] = useState<ServiceRefDto[]>([])
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

  // Prompt 23 — Clients v1 links to a specific conversation from a
  // customer's detail view via /conversations?open=<id>, reusing this
  // page's existing internal open/close mechanism (no new route). The
  // param is consumed once on mount and then stripped from the URL so
  // navigating back/forward or reopening the page later doesn't
  // re-trigger it.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    const toOpen = searchParams.get('open')
    if (toOpen) {
      setOpenId(toOpen)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadReferenceData() {
    try {
      const [customersResult, requestsResult, vehiclesResult, servicesResult] = await Promise.all([
        apiFetch<Paginated<CustomerRefDto>>('/api/customers?pageSize=100&includeInactive=true'),
        apiFetch<Paginated<CustomerRequestRefDto>>('/api/customer-requests?pageSize=100'),
        apiFetch<Paginated<VehicleRefDto>>('/api/vehicles?pageSize=100&includeInactive=true'),
        apiFetch<{ services: ServiceRefDto[] }>('/api/services?activeOnly=false'),
      ])
      setCustomers(customersResult.items)
      setCustomerRequests(requestsResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
    } catch {
      // Non-fatal: the conversation list/detail still work, just fall back
      // to "Неизвестный клиент" / omitted context-panel sections.
    }
  }

  async function loadAttention() {
    try {
      const [open, inProgress] = await Promise.all([
        apiFetch<Paginated<EscalationDto>>('/api/escalations?status=OPEN&pageSize=100'),
        apiFetch<Paginated<EscalationDto>>('/api/escalations?status=IN_PROGRESS&pageSize=100'),
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

  function openDetail(id: string) {
    setOpenId(id)
  }

  function closeDetail() {
    setOpenId(null)
  }

  /** Detail panel changed something (new message, status toggle) — refresh the list/attention data behind it so it's accurate when the user goes back. */
  function handleDetailChanged() {
    void loadConversations()
    void loadAttention()
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

  // Conversation Detail v1 (Prompt 22) — an open conversation takes over
  // the whole screen (its own header/back action) instead of stacking an
  // inline card below the list, matching spec §4's "full operational
  // screen" intent while staying on the same /conversations route (no new
  // route was created — see ConversationDetailPanel.tsx's own header
  // comment for the audit reasoning).
  if (openId) {
    return (
      <PageContainer className="max-w-5xl">
        <ConversationDetailPanel
          conversationId={openId}
          canManage={canManage}
          customers={customers}
          vehicles={vehicles}
          services={services}
          customerRequests={customerRequests}
          onBack={closeDetail}
          onChanged={handleDetailChanged}
        />
      </PageContainer>
    )
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
                      <div className="truncate font-medium">{customerName(customers, conv.customerId)}</div>
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
            <h2 className="text-lg font-semibold leading-none tracking-tight">Новый разговор</h2>
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
    </PageContainer>
  )
}
