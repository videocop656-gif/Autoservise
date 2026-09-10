import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Inbox, Clock, RefreshCw, ArrowRight } from 'lucide-react'
import { PageContainer } from '../components/layout/PageContainer'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { apiFetch, ApiClientError } from '../lib/apiClient'
import {
  type CustomerRequestDto,
  type CustomerRequestStatus,
  type CustomerRefDto,
  type EscalationDto,
  type EscalationStatus,
  type Paginated,
  REQUEST_STATUS_LABELS,
  ESCALATION_STATUS_LABELS,
  NEXT_STATUSES,
  isTerminalStatus,
  customerName,
  formatActivity,
} from '../components/requests/shared'

const ESCALATION_STATUS_BADGE: Record<EscalationStatus, 'warning' | 'default'> = {
  OPEN: 'warning',
  IN_PROGRESS: 'default',
  RESOLVED: 'default',
  CANCELLED: 'default',
}

// ---------------------------------------------------------------------------
// Prompt 25 — Operational Work Queue v1.
//
// This is not a new business entity or a new backend concept — it is a
// cross-entity READ view over data that already exists, aggregating three
// objective, already-established signals (spec's own STEP 2 constraint:
// never invent priority/SLA/assignment/urgency where the backend has none):
//
//   "Требует внимания" (headline)  -> active AiEscalation rows (OPEN/
//     IN_PROGRESS) + CustomerRequest rows with status=NEW, merged and
//     sorted by their own real createdAt. These are the only two states in
//     the whole system with an unambiguous, already-established "this
//     needs a first look" meaning (escalation = AI itself flagged it;
//     NEW = nobody has acted on this request yet).
//   "Новые заявки"                 -> CustomerRequest.status === 'NEW'
//     only. Conversations have no analogous "brand new, unanswered"
//     sub-state (only OPEN/CLOSED) — distinguishing a truly-new,
//     never-replied-to conversation from one that has been open and
//     active for days would require reading its message list per
//     conversation (N+1, explicitly forbidden by spec STEP 7), so no
//     "new conversations" bucket is shown. Documented in the Final Report,
//     not silently invented.
//   "Ожидают дальнейшего действия" -> CustomerRequest.status IN
//     ('IN_PROGRESS', 'WAITING_CUSTOMER') — the real, already-existing
//     statuses, sorted client-side by their own real updatedAt (most
//     recently touched first).
//   "Эскалации"                    -> the same active AiEscalation rows,
//     shown with their real reason/summary/priority.
//
// Every row links into an ALREADY-EXISTING detail flow via the same
// `?open=<id>` mechanism established in Prompts 23/24 — no new detail UI,
// no new route beyond this one aggregation screen, no new mutation.
//
// Data fetching: exactly 6 independent GET requests, run together via
// Promise.allSettled (2x customer-requests status filters beyond NEW,
// 2x escalation status filters, 1x NEW requests, 1x customers reference
// list) — never nested, never per-row, never inside `.map()`. See the
// Final Report's "N+1 Audit" section for the full accounting.
// ---------------------------------------------------------------------------

interface AttentionItem {
  key: string
  kind: 'escalation' | 'request'
  badgeLabel: string
  title: string
  subtitle: string
  timestamp: string
  href: string
  customerId: string | null
}

function StatusActionSelect({
  status,
  requestId,
  onChanged,
}: {
  status: CustomerRequestStatus
  requestId: string
  onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: CustomerRequestStatus) {
    setError(null)
    setPending(true)
    try {
      await apiFetch(`/api/customer-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось изменить статус.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Prompt 27 — only the request's real current status + its real
          allowed next statuses (NEXT_STATUSES, mirroring
          customerRequestService.ts's own ALLOWED_TRANSITIONS), never all 7
          regardless of validity. Terminal statuses (CONVERTED/CLOSED/
          CANCELLED) get a disabled, single-option control instead. */}
      <select
        value={status}
        disabled={pending || isTerminalStatus(status)}
        onChange={(e) => handleChange(e.target.value as CustomerRequestStatus)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
        aria-label="Изменить статус заявки"
      >
        <option value={status}>{REQUEST_STATUS_LABELS[status]}</option>
        {NEXT_STATUSES[status].map((s) => (
          <option key={s} value={s}>
            {REQUEST_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
      <span className="text-destructive">Не удалось загрузить данные</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        Повторить
      </Button>
    </div>
  )
}

function SectionSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  )
}

export default function OperationsPage() {
  const [newRequests, setNewRequests] = useState<CustomerRequestDto[]>([])
  const [inProgressRequests, setInProgressRequests] = useState<CustomerRequestDto[]>([])
  const [escalations, setEscalations] = useState<EscalationDto[]>([])
  const [customers, setCustomers] = useState<CustomerRefDto[]>([])

  const [requestsError, setRequestsError] = useState(false)
  const [escalationsError, setEscalationsError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  async function loadAll() {
    setLoading(true)
    const [newResult, inProgressResult, waitingResult, openEscResult, inProgEscResult, customersResult] = await Promise.allSettled([
      apiFetch<Paginated<CustomerRequestDto>>('/api/customer-requests?status=NEW&pageSize=20'),
      apiFetch<Paginated<CustomerRequestDto>>('/api/customer-requests?status=IN_PROGRESS&pageSize=20'),
      apiFetch<Paginated<CustomerRequestDto>>('/api/customer-requests?status=WAITING_CUSTOMER&pageSize=20'),
      apiFetch<Paginated<EscalationDto>>('/api/escalations?status=OPEN&pageSize=20'),
      apiFetch<Paginated<EscalationDto>>('/api/escalations?status=IN_PROGRESS&pageSize=20'),
      apiFetch<Paginated<CustomerRefDto>>('/api/customers?pageSize=100&includeInactive=true'),
    ])

    if (newResult.status === 'fulfilled' && inProgressResult.status === 'fulfilled' && waitingResult.status === 'fulfilled') {
      setNewRequests(newResult.value.items)
      setInProgressRequests(
        [...inProgressResult.value.items, ...waitingResult.value.items].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      )
      setRequestsError(false)
    } else {
      setNewRequests([])
      setInProgressRequests([])
      setRequestsError(true)
    }

    if (openEscResult.status === 'fulfilled' && inProgEscResult.status === 'fulfilled') {
      setEscalations(
        [...openEscResult.value.items, ...inProgEscResult.value.items].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
      )
      setEscalationsError(false)
    } else {
      setEscalations([])
      setEscalationsError(true)
    }

    setCustomers(customersResult.status === 'fulfilled' ? customersResult.value.items : [])
    setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function retry() {
    setRefreshKey((k) => k + 1)
  }

  const attentionItems: AttentionItem[] = [
    ...escalations.map((e) => ({
      key: `esc-${e.id}`,
      kind: 'escalation' as const,
      badgeLabel: 'Эскалация',
      title: e.reason,
      subtitle: e.summary ?? '',
      timestamp: e.createdAt,
      href: `/conversations?open=${e.conversationId}`,
      customerId: e.customerId,
    })),
    ...newRequests.map((r) => ({
      key: `req-${r.id}`,
      kind: 'request' as const,
      badgeLabel: 'Новая заявка',
      title: r.subject,
      subtitle: r.description ?? '',
      timestamp: r.createdAt,
      href: `/requests?open=${r.id}`,
      customerId: r.customerId,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const hasError = requestsError || escalationsError

  return (
    <PageContainer className="max-w-5xl space-y-6">
      <PageHeader
        title="Рабочая очередь"
        subtitle="Здесь собраны заявки и эскалации, которые требуют внимания администратора"
        actions={
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Обновить
          </Button>
        }
      />

      {/* Section 1 — Требует внимания (merged headline feed) */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <AlertTriangle className="h-5 w-5 text-primary" aria-hidden="true" />
          <CardTitle>Требует внимания</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <SectionSkeleton />}
          {!loading && hasError && <SectionError onRetry={retry} />}
          {!loading && !hasError && attentionItems.length === 0 && (
            <p className="text-sm text-muted-foreground">Сейчас ничего не требует внимания.</p>
          )}
          {!loading &&
            !hasError &&
            attentionItems.slice(0, 10).map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.kind === 'escalation' ? 'destructive' : 'gold'}>{item.badgeLabel}</Badge>
                    <span className="text-xs text-muted-foreground">{formatActivity(item.timestamp)}</span>
                  </div>
                  <div className="mt-1 truncate font-medium">{item.title}</div>
                  {item.subtitle && <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>}
                  {item.customerId && (
                    <Link to={`/clients?open=${item.customerId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                      {customerName(customers, item.customerId)}
                    </Link>
                  )}
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link to={item.href}>
                    {item.kind === 'escalation' ? 'Открыть диалог' : 'Открыть заявку'}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Section 2 — Новые заявки */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">Новые заявки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <SectionSkeleton />}
            {!loading && requestsError && <SectionError onRetry={retry} />}
            {!loading && !requestsError && newRequests.length === 0 && (
              <p className="text-sm text-muted-foreground">Новых заявок нет.</p>
            )}
            {!loading &&
              !requestsError &&
              newRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
                  <div className="min-w-0">
                    <Link to={`/requests?open=${r.id}`} className="block truncate font-medium hover:underline">
                      {r.subject}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {customerName(customers, r.customerId)} · {formatActivity(r.createdAt)}
                    </p>
                  </div>
                  <StatusActionSelect status={r.status} requestId={r.id} onChanged={retry} />
                </div>
              ))}
          </CardContent>
        </Card>

        {/* Section 3 — Ожидают дальнейшего действия */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">Ожидают дальнейшего действия</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <SectionSkeleton />}
            {!loading && requestsError && <SectionError onRetry={retry} />}
            {!loading && !requestsError && inProgressRequests.length === 0 && (
              <p className="text-sm text-muted-foreground">Заявок в процессе нет.</p>
            )}
            {!loading &&
              !requestsError &&
              inProgressRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-sm">
                  <div className="min-w-0">
                    <Link to={`/requests?open=${r.id}`} className="block truncate font-medium hover:underline">
                      {r.subject}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {customerName(customers, r.customerId)} · {REQUEST_STATUS_LABELS[r.status]} · {formatActivity(r.updatedAt)}
                    </p>
                  </div>
                  <StatusActionSelect status={r.status} requestId={r.id} onChanged={retry} />
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {/* Section 4 — Эскалации */}
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Эскалации</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <SectionSkeleton />}
          {!loading && escalationsError && <SectionError onRetry={retry} />}
          {!loading && !escalationsError && escalations.length === 0 && (
            <p className="text-sm text-muted-foreground">Активных эскалаций нет.</p>
          )}
          {!loading &&
            !escalationsError &&
            escalations.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ESCALATION_STATUS_BADGE[e.status]}>{ESCALATION_STATUS_LABELS[e.status]}</Badge>
                    <span className="text-xs text-muted-foreground">{formatActivity(e.createdAt)}</span>
                  </div>
                  <div className="mt-1 truncate font-medium">{e.reason}</div>
                  {e.summary && <p className="truncate text-muted-foreground">{e.summary}</p>}
                  {e.customerId && (
                    <Link to={`/clients?open=${e.customerId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
                      {customerName(customers, e.customerId)}
                    </Link>
                  )}
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link to={`/conversations?open=${e.conversationId}`}>
                    Открыть диалог
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ))}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
