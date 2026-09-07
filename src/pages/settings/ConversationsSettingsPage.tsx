import { useEffect, useState, type FormEvent } from 'react'
import { Plus, MessageSquare, Lock, Unlock } from 'lucide-react'
import Nav from '../../components/Nav'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type ConversationChannel = 'MANUAL' | 'WEBSITE' | 'TELEGRAM' | 'WHATSAPP' | 'PHONE' | 'OTHER'
type ConversationStatus = 'OPEN' | 'CLOSED'
type MessageDirection = 'INBOUND' | 'OUTBOUND'
type MessageSenderType = 'CUSTOMER' | 'STAFF' | 'SYSTEM'

interface MessageDto {
  id: string
  conversationId: string
  direction: MessageDirection
  senderType: MessageSenderType
  content: string
  createdAt: string
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

export default function ConversationsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'

  const [data, setData] = useState<Paginated<ConversationDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customerRequests, setCustomerRequests] = useState<CustomerRequestDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | ''>('')
  const [channelFilter, setChannelFilter] = useState<ConversationChannel | ''>('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

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

  function customerLabel(id: string | null): string {
    if (!id) return '—'
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : id
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
      // Non-fatal: the conversation list still works, just shows raw ids as a fallback.
    }
  }

  async function loadConversations() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (channelFilter) params.set('channel', channelFilter)
      if (search.trim()) params.set('search', search.trim())
      const result = await apiFetch<Paginated<ConversationDto>>(`/api/conversations?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить разговоры.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [])

  useEffect(() => {
    void loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, channelFilter, search])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, channelFilter, search])

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

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Разговоры</CardTitle>
              <CardDescription>Коммуникационный фундамент — без AI и внешних каналов.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input placeholder="Поиск по теме..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ConversationStatus | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
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
              >
                <option value="">Все каналы</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Разговоров пока нет.</p>}

            {data?.items.map((conv) => (
              <div key={conv.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">{conv.subject ?? '(без темы)'}</div>
                  <p className="text-sm text-muted-foreground">
                    {customerLabel(conv.customerId)} · {conv.channel} ·{' '}
                    {conv.lastMessageAt ? `последнее: ${new Date(conv.lastMessageAt).toLocaleString()}` : `создан: ${new Date(conv.createdAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${conv.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}
                  >
                    {STATUS_LABELS[conv.status]}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => openDetail(conv.id)}>
                    <MessageSquare className="mr-1 h-4 w-4" />
                    Open
                  </Button>
                </div>
              </div>
            ))}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {showCreateForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Новый разговор</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="conv-customer">Customer (optional)</Label>
                    <select
                      id="conv-customer"
                      value={createForm.customerId}
                      onChange={(e) => setCreateForm({ ...createForm, customerId: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">Unknown / not yet identified</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="conv-request">Customer Request (optional)</Label>
                    <select
                      id="conv-request"
                      value={createForm.customerRequestId}
                      onChange={(e) => setCreateForm({ ...createForm, customerRequestId: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">None</option>
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="conv-channel">Channel</Label>
                    <select
                      id="conv-channel"
                      value={createForm.channel}
                      onChange={(e) => setCreateForm({ ...createForm, channel: e.target.value as ConversationChannel })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="conv-subject">Subject (optional)</Label>
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
                    {saving ? 'Сохранение...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {openId && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{detail?.subject ?? '(без темы)'}</CardTitle>
                <CardDescription>
                  {detail ? `${detail.channel} · ${customerLabel(detail.customerId)}` : 'Загрузка...'}
                  {detail?.customerRequest ? ` · заявка: ${detail.customerRequest.subject}` : ''}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {detail && canManage && (
                  <Button variant="outline" size="sm" onClick={handleToggleStatus}>
                    {detail.status === 'OPEN' ? (
                      <>
                        <Lock className="mr-1 h-4 w-4" />
                        Close conversation
                      </>
                    ) : (
                      <>
                        <Unlock className="mr-1 h-4 w-4" />
                        Reopen conversation
                      </>
                    )}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={closeDetail}>
                  Close panel
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
                    {detail.messages?.map((m) => (
                      <div key={m.id} className={`rounded-md p-2 text-sm ${m.direction === 'INBOUND' ? 'bg-muted' : 'bg-accent'}`}>
                        <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{m.direction}</span>
                          <span>·</span>
                          <span>{m.senderType}</span>
                          <span>·</span>
                          <span>{new Date(m.createdAt).toLocaleString()}</span>
                        </div>
                        <div>{m.content}</div>
                      </div>
                    ))}
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
                          {sending ? 'Отправка...' : 'Send'}
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
      </div>
    </div>
  )
}
