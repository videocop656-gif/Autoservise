import { useState } from 'react'
import { Bot } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

// ---------------------------------------------------------------------------
// MCR-5 — the business-level kill switch for automatic AI replies.
// Default OFF. Owner/admin change it (same rule as the rest of the business
// profile, PATCH /api/business); a manager sees the state read-only.
// Turning it on does not connect any channel: AI only answers in channels
// that can deliver (today WhatsApp — a mock until the real integration).
// ---------------------------------------------------------------------------

export function AiAutoReplySettingsCard() {
  const { user, business, refresh } = useAuth()
  const canEdit = user?.role === 'owner' || user?.role === 'admin'
  const enabled = !!business?.aiAutoReplyEnabled
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (!canEdit || saving) return
    setError(null)
    setSaving(true)
    try {
      await apiFetch('/api/business', { method: 'PATCH', body: JSON.stringify({ aiAutoReplyEnabled: !enabled }) })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось сохранить настройку.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Автоматические ответы AI
        </CardTitle>
        <CardDescription>
          Когда функция включена, AI может автоматически отвечать на входящие сообщения клиентов — по услугам, ценам,
          адресу и графику из настроек автосервиса. Записи AI не создаёт и цен не придумывает: если нужен человек, он
          передаёт диалог сотруднику. При ответе сотрудника AI в этом диалоге автоматически приостанавливается.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Автоматические ответы AI"
            disabled={!canEdit || saving}
            onClick={() => void toggle()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              enabled ? 'border-primary bg-primary' : 'border-border bg-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-background shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
          <Badge variant={enabled ? 'success' : 'default'}>{enabled ? 'Включены' : 'Выключены'}</Badge>
          {saving && <span className="text-xs text-muted-foreground">Сохранение…</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Работает в каналах, через которые можно ответить клиенту (сейчас — WhatsApp). Включение не подключает
          WhatsApp само по себе. {!canEdit && 'Изменить настройку может владелец или администратор.'}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
