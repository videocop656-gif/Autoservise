import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { apiFetch } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'

type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

interface DayHours {
  dayOfWeek: DayOfWeek
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

const DAY_ORDER: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: 'Пн',
  TUESDAY: 'Вт',
  WEDNESDAY: 'Ср',
  THURSDAY: 'Чт',
  FRIDAY: 'Пт',
  SATURDAY: 'Сб',
  SUNDAY: 'Вс',
}

/** Groups consecutive days that share the same open/closed+times into ranges like "Пн–Пт 09:00–18:00". */
function summarizeHours(days: DayHours[]): string {
  const ordered = DAY_ORDER.map((d) => days.find((day) => day.dayOfWeek === d)).filter((d): d is DayHours => Boolean(d))
  if (ordered.length === 0) return '—'

  const key = (d: DayHours) => (d.isOpen ? `${d.openTime}-${d.closeTime}` : 'closed')
  const groups: { label: string; days: DayOfWeek[] }[] = []

  for (const day of ordered) {
    const k = key(day)
    const last = groups[groups.length - 1]
    if (last && last.label === k) {
      last.days.push(day.dayOfWeek)
    } else {
      groups.push({ label: k, days: [day.dayOfWeek] })
    }
  }

  return groups
    .map((g) => {
      const dayLabel =
        g.days.length > 1 ? `${DAY_SHORT[g.days[0]!]}–${DAY_SHORT[g.days[g.days.length - 1]!]}` : DAY_SHORT[g.days[0]!]
      const timeLabel = g.label === 'closed' ? 'выходной' : g.label.replace('-', '–')
      return `${dayLabel} ${timeLabel}`
    })
    .join(', ')
}

// --- Dashboard / Analytics (Prompt 14) --------------------------------
//
// Every number below comes pre-aggregated from GET /api/dashboard — this
// page never fetches raw CustomerRequests/Messages/AiLogs/Appointments and
// never computes a rate, groupBy, or conversion itself (spec §31). It only
// requests, receives, and displays.

type DashboardPeriod = 'today' | '7d' | '30d' | '90d'

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
]

interface CountBy<K extends string> {
  count: number
}
type Breakdown<Key extends string, Field extends string> = ({ [F in Field]: Key } & CountBy<Key>)[]

interface DailyPoint {
  date: string
  count: number
}

interface DashboardData {
  period: DashboardPeriod
  range: { startDate: string; endDate: string }
  customerRequests: { total: number; byStatus: Breakdown<string, 'status'> }
  conversations: { total: number; byChannel: Breakdown<string, 'channel'>; byStatus: Breakdown<string, 'status'> }
  messages: { total: number; inbound: number; outbound: number }
  ai: {
    totalAnalyses: number
    successful: number
    failed: number
    rejected: number
    escalated: number
    averageConfidence: number | null
    byIntent: Breakdown<string, 'intent'>
    byOutcome: Breakdown<string, 'outcome'>
    successRate: number
    escalationRate: number
  }
  tools: { totalExecutions: number; successful: number; failed: number; byName: Breakdown<string, 'tool'>; successRate: number }
  escalations: {
    total: number
    open: number
    inProgress: number
    resolved: number
    cancelled: number
    byPriority: Breakdown<string, 'priority'>
  }
  appointments: { total: number; byStatus: Breakdown<string, 'status'>; completed: number; cancelled: number; noShow: number }
  serviceHistory: { total: number; revenueByCurrency: { currency: string; total: string }[] }
  services: { active: number; total: number }
  customers: { active: number; new: number }
  vehicles: { active: number; new: number }
  conversion: { customerRequestToAppointment: number | null }
  customerRequestsByDay: DailyPoint[]
  aiAnalysesByDay: DailyPoint[]
  escalationsByDay: DailyPoint[]
  appointmentsByDay: DailyPoint[]
}

function formatPercent(v: number | null): string {
  if (v === null) return '—'
  return `${Math.round(v * 100)}%`
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  )
}

/** A simple, dependency-free horizontal breakdown list — a labeled proportional bar per row, never a heavy chart library (spec §30). */
function BreakdownList({ items, empty }: { items: { label: string; count: number }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm">
          <span className="w-40 shrink-0 truncate text-muted-foreground">{item.label}</span>
          <span className="h-2 flex-1 rounded bg-muted">
            <span className="block h-2 rounded bg-primary/70" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="w-8 shrink-0 text-right font-medium">{item.count}</span>
        </li>
      ))}
    </ul>
  )
}

/** Same principle as BreakdownList, laid out as a simple accessible bar chart with a text summary for screen readers — no chart library added (spec §30). */
function DailyBarChart({ label, data }: { label: string; data: DailyPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((sum, d) => sum + d.count, 0)
  const summary = data.map((d) => `${d.date}: ${d.count}`).join(', ')
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{total}</span>
      </div>
      <div className="flex h-16 items-end gap-0.5" role="img" aria-label={`${label} по дням: ${summary}`}>
        {data.map((d) => (
          <div
            key={d.date}
            className="min-w-[2px] flex-1 rounded-sm bg-primary/60"
            style={{ height: `${(d.count / max) * 100}%` }}
            title={`${d.date}: ${d.count}`}
          />
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, tenant, business } = useAuth()
  const [activeServiceCount, setActiveServiceCount] = useState<number | null>(null)
  const [hoursSummary, setHoursSummary] = useState<string | null>(null)

  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ services: unknown[] }>('/api/services?activeOnly=true')
      .then((data) => setActiveServiceCount(data.services.length))
      .catch(() => setActiveServiceCount(null))

    apiFetch<{ hours: DayHours[] }>('/api/business/hours')
      .then((data) => setHoursSummary(summarizeHours(data.hours)))
      .catch(() => setHoursSummary(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiFetch<DashboardData>(`/api/dashboard?period=${period}`)
      .then(setData)
      .catch(() => setError('Не удалось загрузить аналитику.'))
      .finally(() => setLoading(false))
  }, [period])

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">{business?.name ?? tenant?.name}</h1>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Активные услуги</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {activeServiceCount === null ? '—' : activeServiceCount}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">Часы работы</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{hoursSummary ?? '—'}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Аккаунт</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Имя:</span> {user?.name}
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span> {user?.email}
            </p>
            <p>
              <span className="text-muted-foreground">Роль:</span> {user?.role}
            </p>
            <p>
              <span className="text-muted-foreground">Tenant ID:</span> {tenant?.id}
            </p>
            <p>
              <span className="text-muted-foreground">Статус аккаунта:</span> {tenant?.status}
            </p>
          </CardContent>
        </Card>

        {/* --- Dashboard / Analytics (Prompt 14) --- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Аналитика</CardTitle>
              <CardDescription>
                {data ? `${data.range.startDate} – ${data.range.endDate} (${business?.timezone ?? 'UTC'})` : 'Загрузка периода…'}
              </CardDescription>
            </div>
            <div className="flex gap-1">
              {PERIOD_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={period === opt.value ? 'default' : 'outline'}
                  onClick={() => setPeriod(opt.value)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {loading && <p className="text-sm text-muted-foreground">Загрузка аналитики...</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && !error && data && data.customerRequests.total === 0 && data.conversations.total === 0 && data.ai.totalAnalyses === 0 && (
              <p className="text-sm text-muted-foreground">За выбранный период данных ещё нет.</p>
            )}
          </CardContent>
        </Card>

        {data && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Заявки" value={data.customerRequests.total} />
              <Kpi label="Разговоры" value={data.conversations.total} />
              <Kpi label="AI-анализы" value={data.ai.totalAnalyses} />
              <Kpi label="AI-эскалации" value={data.ai.escalated} />
              <Kpi label="Записи" value={data.appointments.total} />
              <Kpi label="Завершено записей" value={data.appointments.completed} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>AI</CardTitle>
                <CardDescription>Только по логам AI_ANALYZE — не намерение модели, а фактический результат (см. AI Logs, Prompt 13).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Success rate</div>
                    <div className="text-lg font-semibold">{formatPercent(data.ai.successRate)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Escalation rate</div>
                    <div className="text-lg font-semibold">{formatPercent(data.ai.escalationRate)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Средняя уверенность</div>
                    <div className="text-lg font-semibold">{formatPercent(data.ai.averageConfidence)}</div>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">По intent</div>
                  <BreakdownList items={data.ai.byIntent.map((i) => ({ label: i.intent, count: i.count }))} empty="Нет данных." />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Записи по статусу</CardTitle>
                </CardHeader>
                <CardContent>
                  <BreakdownList items={data.appointments.byStatus.map((s) => ({ label: s.status, count: s.count }))} empty="Нет записей." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Эскалации по приоритету</CardTitle>
                </CardHeader>
                <CardContent>
                  <BreakdownList
                    items={data.escalations.byPriority.map((p) => ({ label: p.priority, count: p.count }))}
                    empty="Нет эскалаций."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Инструменты AI</CardTitle>
                  <CardDescription>Success rate: {formatPercent(data.tools.successRate)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <BreakdownList items={data.tools.byName.map((t) => ({ label: t.tool, count: t.count }))} empty="Инструменты не вызывались." />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Сервис и клиенты</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-sm text-muted-foreground">История обслуживания</div>
                  <div className="text-lg font-semibold">{data.serviceHistory.total}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Выручка по валютам</div>
                  {data.serviceHistory.revenueByCurrency.length === 0 ? (
                    <div className="text-lg font-semibold">—</div>
                  ) : (
                    data.serviceHistory.revenueByCurrency.map((r) => (
                      <div key={r.currency} className="text-lg font-semibold">
                        {r.total} {r.currency}
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Активные клиенты</div>
                  <div className="text-lg font-semibold">{data.customers.active}</div>
                  <div className="text-xs text-muted-foreground">новых за период: {data.customers.new}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Активные автомобили</div>
                  <div className="text-lg font-semibold">{data.vehicles.active}</div>
                  <div className="text-xs text-muted-foreground">новых за период: {data.vehicles.new}</div>
                </div>
              </CardContent>
              {data.conversion.customerRequestToAppointment !== null && (
                <CardContent className="border-t pt-4 text-sm">
                  <span className="text-muted-foreground">Конверсия заявка → запись (за период):</span>{' '}
                  <span className="font-medium">{formatPercent(data.conversion.customerRequestToAppointment)}</span>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Активность по дням</CardTitle>
                <CardDescription>{business?.timezone ?? 'UTC'} — местное время бизнеса, не UTC.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DailyBarChart label="Заявки" data={data.customerRequestsByDay} />
                <DailyBarChart label="AI-анализы" data={data.aiAnalysesByDay} />
                <DailyBarChart label="Эскалации" data={data.escalationsByDay} />
                <DailyBarChart label="Записи" data={data.appointmentsByDay} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
