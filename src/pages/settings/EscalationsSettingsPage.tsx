import { useEffect, useState } from 'react'
import { AlertTriangle, UserCheck, CheckCircle2, XCircle } from 'lucide-react'
import Nav from '../../components/Nav'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
type EscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

interface EscalationDto {
  id: string
  conversationId: string
  customerId: string | null
  status: EscalationStatus
  priority: EscalationPriority
  reason: string
  summary: string | null
  assignedUserId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  customer?: { id: string; firstName: string; lastName: string | null } | null
  assignedUser?: { id: string; name: string } | null
  conversation?: { id: string; subject: string | null; status: string; channel: string } | null
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const STATUSES: EscalationStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']
const PRIORITIES: EscalationPriority[] = ['URGENT', 'HIGH', 'NORMAL', 'LOW']

const STATUS_LABELS: Record<EscalationStatus, string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  RESOLVED: 'Решена',
  CANCELLED: 'Отменена',
}

const STATUS_COLORS: Record<EscalationStatus, string> = {
  OPEN: 'bg-red-100 text-red-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-muted text-muted-foreground',
}

const PRIORITY_COLORS: Record<EscalationPriority, string> = {
  URGENT: 'bg-red-100 text-red-800',
  HIGH: 'bg-orange-100 text-orange-800',
  NORMAL: 'bg-slate-100 text-slate-700',
  LOW: 'bg-slate-100 text-slate-500',
}

// Human Escalation is a staff workflow, not a customer-facing feature — this
// page never sends anything to a customer (spec §"FRONTEND"). Owner/admin/
// manager all get the same operational access (same exception already
// established for Appointment/Conversation/AI Core), enforced server-side
// regardless of what this page shows or hides.
export default function EscalationsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager'

  const [data, setData] = useState<Paginated<EscalationDto> | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<EscalationStatus | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<EscalationPriority | ''>('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<EscalationDto | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  function customerLabel(c: EscalationDto['customer']): string {
    if (!c) return '—'
    return `${c.firstName} ${c.lastName ?? ''}`.trim()
  }

  async function loadEscalations() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (priorityFilter) params.set('priority', priorityFilter)
      if (unassignedOnly) params.set('unassignedOnly', 'true')
      const result = await apiFetch<Paginated<EscalationDto>>(`/api/escalations?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить эскалации.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEscalations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, priorityFilter, unassignedOnly])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, priorityFilter, unassignedOnly])

  async function loadDetail(id: string) {
    setDetailError(null)
    try {
      const result = await apiFetch<{ escalation: EscalationDto }>(`/api/escalations/${id}`)
      setDetail(result.escalation)
    } catch {
      setDetailError('Не удалось загрузить эскалацию.')
    }
  }

  function openDetail(id: string) {
    setOpenId(id)
    setDetail(null)
    setActionError(null)
    void loadDetail(id)
  }

  function closeDetail() {
    setOpenId(null)
    setDetail(null)
  }

  async function runAction(action: 'claim' | 'resolve' | 'cancel') {
    if (!detail) return
    setActionError(null)
    setActionBusy(true)
    try {
      await apiFetch(`/api/escalations/${detail.id}/${action}`, { method: 'POST' })
      await loadDetail(detail.id)
      await loadEscalations()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось выполнить действие.')
    } finally {
      setActionBusy(false)
    }
  }

  const canClaim = detail && canManage && (detail.status === 'OPEN' || (detail.status === 'IN_PROGRESS' && detail.assignedUserId === user?.id))
  const canResolve = detail && canManage && (detail.status === 'OPEN' || detail.status === 'IN_PROGRESS')
  const canCancel = detail && canManage && (detail.status === 'OPEN' || detail.status === 'IN_PROGRESS')

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Human Escalations
            </CardTitle>
            <CardDescription>
              Обращения, которые AI не смог обработать самостоятельно (needsHuman = true) и передал сотруднику.
              AI никогда не решает и не отменяет эскалацию сам — это делает только сотрудник вручную.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as EscalationStatus | '')}
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
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as EscalationPriority | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все приоритеты</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
                Только неназначенные
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Эскалаций пока нет.</p>}

            {data?.items.map((esc) => (
              <div key={esc.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">{esc.reason}</div>
                  <p className="text-sm text-muted-foreground">
                    {customerLabel(esc.customer)} · создана {new Date(esc.createdAt).toLocaleString()}
                    {esc.assignedUser ? ` · назначено: ${esc.assignedUser.name}` : ' · не назначено'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_COLORS[esc.priority]}`}>{esc.priority}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[esc.status]}`}>{STATUS_LABELS[esc.status]}</span>
                  <Button variant="outline" size="sm" onClick={() => openDetail(esc.id)}>
                    Open
                  </Button>
                </div>
              </div>
            ))}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {openId && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Эскалация</CardTitle>
                <CardDescription>
                  {detail ? `${STATUS_LABELS[detail.status]} · ${detail.priority}` : 'Загрузка...'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={closeDetail}>
                Close panel
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {detailError && <p className="text-sm text-destructive">{detailError}</p>}
              {!detail && !detailError && <p className="text-sm text-muted-foreground">Загрузка...</p>}

              {detail && (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Клиент</div>
                      <div className="font-medium">{customerLabel(detail.customer)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Разговор</div>
                      <div className="font-medium">{detail.conversation?.subject ?? '(без темы)'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Назначено</div>
                      <div className="font-medium">{detail.assignedUser?.name ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Создана</div>
                      <div className="font-medium">{new Date(detail.createdAt).toLocaleString()}</div>
                    </div>
                    {detail.resolvedAt && (
                      <div>
                        <div className="text-muted-foreground">Решена</div>
                        <div className="font-medium">{new Date(detail.resolvedAt).toLocaleString()}</div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-1 text-sm text-muted-foreground">Причина (от AI)</div>
                    <div className="rounded-md border bg-muted/50 p-3 text-sm">{detail.reason}</div>
                  </div>

                  {detail.summary && (
                    <div>
                      <div className="mb-1 text-sm text-muted-foreground">Сводка</div>
                      <div className="rounded-md border bg-muted/50 p-3 text-sm">{detail.summary}</div>
                    </div>
                  )}

                  {actionError && <p className="text-sm text-destructive">{actionError}</p>}

                  <div className="flex flex-wrap gap-2">
                    {canClaim && (
                      <Button size="sm" variant="outline" disabled={actionBusy} onClick={() => runAction('claim')}>
                        <UserCheck className="mr-1 h-4 w-4" />
                        {detail.assignedUserId === user?.id ? 'Claimed by you' : 'Claim'}
                      </Button>
                    )}
                    {canResolve && (
                      <Button size="sm" disabled={actionBusy} onClick={() => runAction('resolve')}>
                        <CheckCircle2 className="mr-1 h-4 w-4" />
                        Resolve
                      </Button>
                    )}
                    {canCancel && (
                      <Button size="sm" variant="outline" disabled={actionBusy} onClick={() => runAction('cancel')}>
                        <XCircle className="mr-1 h-4 w-4" />
                        Cancel
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Разговор с клиентом можно посмотреть на странице{' '}
                    <a href="/settings/conversations" className="underline">
                      Conversations
                    </a>
                    .
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
