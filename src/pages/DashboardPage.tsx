import { useEffect, useState } from 'react'
import { Wrench } from 'lucide-react'
import Nav from '../components/Nav'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
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

export default function DashboardPage() {
  const { user, tenant, business } = useAuth()
  const [activeServiceCount, setActiveServiceCount] = useState<number | null>(null)
  const [hoursSummary, setHoursSummary] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ services: unknown[] }>('/api/services?activeOnly=true')
      .then((data) => setActiveServiceCount(data.services.length))
      .catch(() => setActiveServiceCount(null))

    apiFetch<{ hours: DayHours[] }>('/api/business/hours')
      .then((data) => setHoursSummary(summarizeHours(data.hours)))
      .catch(() => setHoursSummary(null))
  }, [])

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              AI-администратор
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Здесь появится AI-ресепшн: обработка заявок, запись на визит и напоминания. Функциональность будет
            добавлена на следующих этапах.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
