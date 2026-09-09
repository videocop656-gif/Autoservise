import { useEffect, useState } from 'react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

interface DayHours {
  dayOfWeek: DayOfWeek
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Понедельник',
  TUESDAY: 'Вторник',
  WEDNESDAY: 'Среда',
  THURSDAY: 'Четверг',
  FRIDAY: 'Пятница',
  SATURDAY: 'Суббота',
  SUNDAY: 'Воскресенье',
}

const DAY_ORDER: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

export default function HoursSettingsPage() {
  const { user, business } = useAuth()
  const canEdit = user?.role === 'owner' || user?.role === 'admin'

  const [days, setDays] = useState<DayHours[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    apiFetch<{ hours: DayHours[] }>('/api/business/hours')
      .then((data) => setDays(data.hours))
      .catch(() => setError('Не удалось загрузить расписание.'))
      .finally(() => setLoading(false))
  }, [])

  function updateDay(day: DayOfWeek, patch: Partial<DayHours>) {
    setDays((prev) => (prev ? prev.map((d) => (d.dayOfWeek === day ? { ...d, ...patch } : d)) : prev))
  }

  function toggleOpen(day: DayOfWeek, isOpen: boolean) {
    updateDay(day, {
      isOpen,
      openTime: isOpen ? '09:00' : null,
      closeTime: isOpen ? '18:00' : null,
    })
  }

  async function handleSave() {
    if (!days) return
    setError(null)
    setSuccess(false)
    setSaving(true)
    try {
      const data = await apiFetch<{ hours: DayHours[] }>('/api/business/hours', {
        method: 'PUT',
        body: JSON.stringify(days),
      })
      setDays(data.hours)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось сохранить расписание.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Часы работы</CardTitle>
            <CardDescription>
              Часовой пояс: {business?.timezone ?? '—'}.{' '}
              {canEdit ? 'Укажите время работы для каждого дня.' : 'Изменение доступно owner/admin.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}

            {days &&
              DAY_ORDER.map((dayKey) => {
                const day = days.find((d) => d.dayOfWeek === dayKey)
                if (!day) return null
                return (
                  <div key={dayKey} className="flex items-center gap-4 rounded-md border p-3">
                    <label className="flex w-40 items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={day.isOpen}
                        disabled={!canEdit}
                        onChange={(e) => toggleOpen(dayKey, e.target.checked)}
                      />
                      {DAY_LABELS[dayKey]}
                    </label>
                    {day.isOpen ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          className="w-32"
                          disabled={!canEdit}
                          value={day.openTime ?? ''}
                          onChange={(e) => updateDay(dayKey, { openTime: e.target.value })}
                        />
                        <span className="text-muted-foreground">—</span>
                        <Input
                          type="time"
                          className="w-32"
                          disabled={!canEdit}
                          value={day.closeTime ?? ''}
                          onChange={(e) => updateDay(dayKey, { closeTime: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Закрыто</span>
                    )}
                  </div>
                )
              })}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-green-600">Расписание сохранено.</p>}

            {canEdit && days && (
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Сохранение...' : 'Save hours'}
              </Button>
            )}
          </CardContent>
        </Card>
    </PageContainer>
  )
}
