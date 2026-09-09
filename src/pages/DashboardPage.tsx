import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  MessageSquare,
  Bot,
  CalendarDays,
  AlertTriangle,
  Users,
  UserRoundCheck,
  Radio,
  ArrowRight,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { PageContainer } from '../components/layout/PageContainer'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'

// ============================================================================
// Dashboard v1 (Prompt 20) — an operational panel, not a decorative stats
// page (spec §3/§4/§36). Every number here comes from an already-existing
// API; nothing is invented. The exact mapping, established during this
// prompt's own audit (STEP 1-2):
//
//   Metric                    → Source
//   ------------------------- → ------------------------------------------
//   Новые обращения (period)  → GET /api/dashboard → conversations.total
//   Обработано AI (period)    → GET /api/dashboard → ai.totalAnalyses/successRate
//   Записи (period)           → GET /api/dashboard → appointments.total
//   Требует внимания (now)    → GET /api/escalations?status=OPEN|IN_PROGRESS
//                                (current, NOT period-scoped — see below)
//   Последние обращения       → GET /api/conversations?pageSize=5
//                                (default sort: lastMessageAt desc — already
//                                the list endpoint's own default order)
//   Ближайшие записи          → GET /api/appointments?dateFrom=now&pageSize=5
//                                (default sort: startAt asc)
//   AI-администратор status   → derived from GET /api/channels (any ACTIVE?)
//                                + the dashboard's own ai.totalAnalyses —
//                                no new backend logic, a purely frontend
//                                read of two already-existing signals.
//   Клиент/автомобиль/услуга  → GET /api/customers|vehicles|services
//   labels on the two lists     (pageSize=100, same pattern already used by
//                                AppointmentsSettingsPage/ConversationsSettingsPage)
//
// GET /api/dashboard's own escalations.open/inProgress are filtered by
// createdAt within the selected period (see analyticsRepository.ts's
// createdAtInRange()) — that undercounts "needs attention right now" for an
// escalation created outside the period but still open today. "Требует
// внимания" is a current-state question (spec §3), so it deliberately reads
// GET /api/escalations directly instead (unfiltered by period), the same
// endpoint EscalationsSettingsPage already uses.
// ============================================================================

type ConversationChannel = 'MANUAL' | 'WEBSITE' | 'TELEGRAM' | 'WHATSAPP' | 'PHONE' | 'OTHER'
type ConversationStatus = 'OPEN' | 'CLOSED'
type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'
type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
type EscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
type ChannelType = 'TELEGRAM' | 'WHATSAPP' | 'WEBSITE'
type ChannelConnectionStatus = 'ACTIVE' | 'INACTIVE'
type DashboardPeriod = 'today' | '7d' | '30d' | '90d'

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface DashboardData {
  period: DashboardPeriod
  conversations: { total: number }
  ai: { totalAnalyses: number; successRate: number }
  appointments: { total: number }
}

interface ConversationDto {
  id: string
  customerId: string | null
  channel: ConversationChannel
  status: ConversationStatus
  subject: string | null
  lastMessageAt: string | null
  createdAt: string
}

interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
  status: AppointmentStatus
}

interface EscalationDto {
  id: string
  customerId: string | null
  status: EscalationStatus
  priority: EscalationPriority
  reason: string
  createdAt: string
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
}

interface VehicleDto {
  id: string
  make: string
  model: string
}

interface ServiceDto {
  id: string
  name: string
}

interface ChannelConnectionDto {
  id: string
  type: ChannelType
  status: ChannelConnectionStatus
}

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
]

const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  MANUAL: 'Вручную',
  WEBSITE: 'Сайт',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Телефон',
  OTHER: 'Другое',
}

const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Запланирована',
  CONFIRMED: 'Подтверждена',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
  NO_SHOW: 'Не пришёл',
}

const ESCALATION_PRIORITY_LABELS: Record<EscalationPriority, string> = {
  LOW: 'Низкий',
  NORMAL: 'Обычный',
  HIGH: 'Высокий',
  URGENT: 'Срочно',
}

function customerName(customers: CustomerDto[], id: string | null): string | null {
  if (!id) return null
  const c = customers.find((x) => x.id === id)
  return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : null
}

function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  )
}

/** Generic {data, loading, error} fetch — the same plain useState/useEffect/apiFetch pattern every other page in this project already uses (spec §23: no new data-fetching architecture). */
function useApi<T>(path: string | null, deps: unknown[]): { data: T | null; loading: boolean; error: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setLoading(true)
    setError(false)
    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  loading,
  error,
  tone,
  action,
}: {
  icon: LucideIcon
  label: string
  value: number | null
  hint?: string
  loading: boolean
  error: boolean
  tone?: 'default' | 'attention'
  action?: { label: string; to: string }
}) {
  return (
    <Card className={tone === 'attention' && (value ?? 0) > 0 ? 'border-primary/40' : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3">
          {loading ? (
            <div className="h-8 w-16 animate-pulse rounded bg-muted" aria-hidden="true" />
          ) : error ? (
            <span className="text-sm text-muted-foreground">Нет данных</span>
          ) : (
            <span className="text-3xl font-semibold text-foreground">{value ?? '—'}</span>
          )}
          {!loading && !error && hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action && (
          <Link
            to={action.to}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {action.label}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Block wrapper — consistent header + CTA + per-block error isolation
// (spec §22: one failed block never hides the rest of the dashboard).
// ---------------------------------------------------------------------------

function DashboardBlock({
  title,
  cta,
  loading,
  error,
  onRetry,
  children,
}: {
  title: string
  cta?: { label: string; to: string }
  loading: boolean
  error: boolean
  onRetry: () => void
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {cta && (
          <Button variant="ghost" size="sm" asChild>
            <Link to={cta.to}>{cta.label}</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Не удалось загрузить данные.</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Повторить
            </Button>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { business } = useAuth()
  const timezone = business?.timezone ?? 'UTC'

  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const [refreshKey, setRefreshKey] = useState(0)

  const dashboard = useApi<DashboardData>(`/api/dashboard?period=${period}`, [period, refreshKey])
  const conversations = useApi<Paginated<ConversationDto>>('/api/conversations?pageSize=5', [refreshKey])
  const [appointmentsFrom] = useState(() => new Date().toISOString())
  const appointments = useApi<Paginated<AppointmentDto>>(
    `/api/appointments?pageSize=5&dateFrom=${encodeURIComponent(appointmentsFrom)}`,
    [refreshKey]
  )
  const openEscalations = useApi<Paginated<EscalationDto>>('/api/escalations?status=OPEN&pageSize=5', [refreshKey])
  const inProgressEscalations = useApi<Paginated<EscalationDto>>('/api/escalations?status=IN_PROGRESS&pageSize=5', [refreshKey])
  const channels = useApi<{ connections: ChannelConnectionDto[] }>('/api/channels', [refreshKey])

  // Reference data for name resolution — the same pageSize=100 pattern
  // AppointmentsSettingsPage/ConversationsSettingsPage already use. Best
  // effort: if this fails, the lists below fall back to omitting the name
  // rather than breaking (spec §22).
  const customersRef = useApi<Paginated<CustomerDto>>('/api/customers?pageSize=100', [refreshKey])
  const vehiclesRef = useApi<Paginated<VehicleDto>>('/api/vehicles?pageSize=100', [refreshKey])
  const servicesRef = useApi<{ services: ServiceDto[] }>('/api/services', [refreshKey])
  const customersList = customersRef.data?.items ?? []
  const vehiclesList = vehiclesRef.data?.items ?? []
  const servicesList = servicesRef.data?.services ?? []

  const attentionTotal = (openEscalations.data?.total ?? 0) + (inProgressEscalations.data?.total ?? 0)
  const attentionItems = [...(openEscalations.data?.items ?? []), ...(inProgressEscalations.data?.items ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
  const attentionLoading = openEscalations.loading || inProgressEscalations.loading
  const attentionError = openEscalations.error || inProgressEscalations.error

  const hasActiveChannel = (channels.data?.connections ?? []).some((c) => c.status === 'ACTIVE')
  const hasAnyChannel = (channels.data?.connections?.length ?? 0) > 0

  function retryAll() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <PageContainer className="max-w-6xl space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Обзор работы AI-администратора и обращений клиентов"
        actions={
          <div className="flex gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <Button key={opt.value} size="sm" variant={period === opt.value ? 'default' : 'outline'} onClick={() => setPeriod(opt.value)}>
                {opt.label}
              </Button>
            ))}
          </div>
        }
      />

      {/* KPI row — mobile: 1 column stacked, tablet: 2x2, desktop: 4 across (spec §20). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={MessageSquare}
          label="Новые обращения"
          value={dashboard.data?.conversations.total ?? null}
          hint="За выбранный период"
          loading={dashboard.loading}
          error={dashboard.error}
        />
        <KpiCard
          icon={Bot}
          label="Обработано AI"
          value={dashboard.data?.ai.totalAnalyses ?? null}
          hint={dashboard.data && dashboard.data.ai.totalAnalyses > 0 ? `Успешно: ${Math.round(dashboard.data.ai.successRate * 100)}%` : 'За выбранный период'}
          loading={dashboard.loading}
          error={dashboard.error}
        />
        <KpiCard
          icon={CalendarDays}
          label="Записи"
          value={dashboard.data?.appointments.total ?? null}
          hint="За выбранный период"
          loading={dashboard.loading}
          error={dashboard.error}
          action={{ label: 'Все записи', to: '/appointments' }}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Требует внимания"
          value={attentionTotal}
          hint={attentionTotal > 0 ? 'Открыто сейчас' : 'Активных нет'}
          loading={attentionLoading}
          error={attentionError}
          tone="attention"
          action={{ label: 'Открыть', to: '/escalations' }}
        />
      </div>

      {/* Main operations area */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardBlock
          title="Последние обращения"
          cta={{ label: 'Все обращения', to: '/conversations' }}
          loading={conversations.loading}
          error={conversations.error}
          onRetry={retryAll}
        >
          {conversations.data?.items.length === 0 ? (
            <>
              <span className="block font-medium text-foreground">Пока нет новых обращений</span>
              Здесь появятся диалоги с клиентами, как только они начнутся.
            </>
          ) : (
            <ul className="space-y-1">
              {conversations.data?.items.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {customerName(customersList, c.customerId) ?? c.subject ?? 'Без темы'}
                      </span>
                      <Badge variant={c.status === 'OPEN' ? 'info' : 'default'}>{c.status === 'OPEN' ? 'Открыт' : 'Закрыт'}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{CHANNEL_LABELS[c.channel]}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.lastMessageAt ? formatDateTime(c.lastMessageAt, timezone) : formatDateTime(c.createdAt, timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashboardBlock>

        <DashboardBlock
          title="Ближайшие записи"
          cta={{ label: 'Все записи', to: '/appointments' }}
          loading={appointments.loading}
          error={appointments.error}
          onRetry={retryAll}
        >
          {appointments.data?.items.length === 0 ? (
            'Ближайших записей нет'
          ) : (
            <ul className="space-y-1">
              {appointments.data?.items.map((a) => {
                const vehicle = vehiclesList.find((v) => v.id === a.vehicleId)
                const service = servicesList.find((s) => s.id === a.serviceId)
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {customerName(customersList, a.customerId) ?? 'Клиент'}
                        </span>
                        <Badge>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[vehicle ? `${vehicle.make} ${vehicle.model}` : null, service?.name].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.startAt, timezone)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </DashboardBlock>
      </div>

      {/* Attention area */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardBlock
          title="Требует внимания"
          cta={{ label: 'Все эскалации', to: '/escalations' }}
          loading={attentionLoading}
          error={attentionError}
          onRetry={retryAll}
        >
          {attentionItems.length === 0 ? (
            'Сейчас ничего не требует вмешательства человека'
          ) : (
            <ul className="space-y-1">
              {attentionItems.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{customerName(customersList, e.customerId) ?? 'Клиент не определён'}</span>
                      <Badge variant={e.priority === 'URGENT' ? 'destructive' : e.priority === 'HIGH' ? 'warning' : 'gold'}>
                        {ESCALATION_PRIORITY_LABELS[e.priority]}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{e.reason}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(e.createdAt, timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </DashboardBlock>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI-администратор</CardTitle>
          </CardHeader>
          <CardContent>
            {channels.loading || dashboard.loading ? (
              <div className="h-10 animate-pulse rounded bg-muted" aria-hidden="true" />
            ) : channels.error || dashboard.error ? (
              <p className="text-sm text-muted-foreground">Статус пока недоступен</p>
            ) : !hasAnyChannel ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge variant="warning">Канал не настроен</Badge>
                  <p className="mt-1.5 text-xs text-muted-foreground">Подключите канал связи, чтобы AI мог отвечать клиентам.</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/channels">Настроить</Link>
                </Button>
              </div>
            ) : !hasActiveChannel ? (
              <div>
                <Badge variant="warning">Требует настройки</Badge>
                <p className="mt-1.5 text-xs text-muted-foreground">Есть подключённые каналы, но ни один не активен.</p>
              </div>
            ) : (dashboard.data?.ai.totalAnalyses ?? 0) > 0 ? (
              <div>
                <Badge variant="success">Активен</Badge>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  AI обработал {dashboard.data?.ai.totalAnalyses} обращени{dashboard.data && dashboard.data.ai.totalAnalyses === 1 ? 'е' : 'й'} за выбранный период.
                </p>
              </div>
            ) : (
              <div>
                <Badge variant="info">Настроен</Badge>
                <p className="mt-1.5 text-xs text-muted-foreground">Канал подключён, AI пока не обрабатывал обращения за этот период.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Быстрые действия</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/conversations">
              <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Обращения
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/appointments">
              <CalendarDays className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Записи
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/clients">
              <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Клиенты
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/escalations">
              <UserRoundCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Требует внимания
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/channels">
              <Radio className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Каналы
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
