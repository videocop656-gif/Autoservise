import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, RefreshCw, Repeat } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { utcToZonedParts, zonedTimeToUtc } from '../../lib/businessTime'
import { customerName, type CustomerRefDto, type Paginated } from '../requests/shared'
import { serviceName, vehicleLabel, type VehicleRefDto, type ServiceRefDto } from '../appointments/shared'
import {
  FOLLOW_UP_BUCKET_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  followUpBucket,
  followUpDueDateStr,
  followUpQueueEndExclusiveDateStr,
  formatFollowUpDueDate,
  sortFollowUpsForQueue,
  type FollowUpBucket,
  type ServiceFollowUpDto,
} from './shared'

const BUCKET_BADGE: Record<FollowUpBucket, 'destructive' | 'gold' | 'default'> = {
  overdue: 'destructive',
  today: 'gold',
  upcoming: 'default',
}

interface FollowUpQueueSectionProps {
  timezone: string
  customers: CustomerRefDto[]
  vehicles: VehicleRefDto[]
  services: ServiceRefDto[]
  /** Bumped by the page's "Обновить" button to reload this section too. */
  refreshKey: number
}

/**
 * Prompt 48 — "Повторный контакт": PENDING follow-ups due up to today + 7
 * days in the Business timezone (overdue first, then today, then upcoming;
 * dueAt ascending). Actions: create a CustomerRequest (→ CONTACTED),
 * postpone (new dueAt, stays PENDING), or dismiss (→ DISMISSED). Handled
 * rows leave the queue on reload because the queue only asks for PENDING.
 */
export function FollowUpQueueSection({ timezone, customers, vehicles, services, refreshKey }: FollowUpQueueSectionProps) {
  const [items, setItems] = useState<ServiceFollowUpDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [createdRequest, setCreatedRequest] = useState<{ id: string; subject: string } | null>(null)
  const [postponingId, setPostponingId] = useState<string | null>(null)
  const [postponeDate, setPostponeDate] = useState('')

  // "Today" is the Business's calendar day, recomputed on every load.
  const todayDateStr = utcToZonedParts(new Date(), timezone).dateStr

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const dueBefore = zonedTimeToUtc(followUpQueueEndExclusiveDateStr(todayDateStr), '00:00', timezone).toISOString()
      try {
        const result = await apiFetch<Paginated<ServiceFollowUpDto>>(
          `/api/follow-ups?status=PENDING&dueBefore=${encodeURIComponent(dueBefore)}&pageSize=100`
        )
        if (!cancelled) {
          setItems(sortFollowUpsForQueue(result.items, todayDateStr, timezone))
          setLoadError(false)
        }
      } catch {
        if (!cancelled) {
          setItems([])
          setLoadError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [refreshKey, reloadKey, timezone, todayDateStr])

  function reload() {
    setReloadKey((k) => k + 1)
  }

  async function runAction(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setActionError(null)
    try {
      await action()
      reload()
    } catch (err) {
      setActionError(err instanceof ApiClientError && err.message ? err.message : 'Не удалось выполнить действие.')
    } finally {
      setBusyId(null)
    }
  }

  function handleCreateRequest(followUp: ServiceFollowUpDto) {
    void runAction(followUp.id, async () => {
      const result = await apiFetch<{ customerRequest: { id: string; subject: string } }>(`/api/follow-ups/${followUp.id}/request`, {
        method: 'POST',
      })
      setCreatedRequest(result.customerRequest)
    })
  }

  function handleDismiss(followUp: ServiceFollowUpDto) {
    void runAction(followUp.id, async () => {
      await apiFetch(`/api/follow-ups/${followUp.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DISMISSED' }) })
    })
  }

  function startPostpone(followUp: ServiceFollowUpDto) {
    setPostponingId(followUp.id)
    setPostponeDate(followUpDueDateStr(followUp.dueAt, timezone))
    setActionError(null)
  }

  function handlePostpone(followUp: ServiceFollowUpDto) {
    if (!postponeDate) return
    void runAction(followUp.id, async () => {
      await apiFetch(`/api/follow-ups/${followUp.id}`, { method: 'PATCH', body: JSON.stringify({ dueAt: postponeDate }) })
      setPostponingId(null)
    })
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Повторный контакт</CardTitle>
        </div>
        {!loading && !loadError && (
          <span className="text-xs text-muted-foreground">Просроченные, сегодня и ближайшие 7 дней — {items.length}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {createdRequest && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
            <span>
              Обращение создано: <span className="font-medium">{createdRequest.subject}</span>
            </span>
            <Button asChild variant="outline" size="sm">
              <Link to={`/requests?open=${createdRequest.id}`}>
                Открыть обращение
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        {loading && <div className="h-14 animate-pulse rounded-md bg-muted/40" aria-hidden="true" />}
        {!loading && loadError && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
            <span className="text-destructive">Не удалось загрузить данные</span>
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Повторить
            </Button>
          </div>
        )}
        {!loading && !loadError && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Повторных контактов на ближайшую неделю нет.</p>
        )}

        {!loading &&
          !loadError &&
          items.map((followUp) => {
            const dueDateStr = followUpDueDateStr(followUp.dueAt, timezone)
            const bucket = followUpBucket(dueDateStr, todayDateStr)
            const vehicle = vehicles.find((v) => v.id === followUp.vehicleId)
            const busy = busyId === followUp.id
            return (
              <div key={followUp.id} className="space-y-2 rounded-md border border-border p-3" data-follow-up-id={followUp.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={BUCKET_BADGE[bucket]}>{FOLLOW_UP_BUCKET_LABELS[bucket]}</Badge>
                      <span className="text-sm font-medium">{formatFollowUpDueDate(followUp.dueAt, timezone)}</span>
                      <Badge variant="default">{FOLLOW_UP_STATUS_LABELS[followUp.status]}</Badge>
                    </div>
                    <Link
                      to={`/clients?open=${followUp.customerId}`}
                      className="mt-1 block truncate font-medium underline-offset-2 hover:underline"
                    >
                      {customerName(customers, followUp.customerId)}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {vehicle ? vehicleLabel(vehicle) : '—'} · {serviceName(services, followUp.serviceId) ?? 'Без услуги'}
                    </p>
                    {followUp.note && <p className="mt-1 text-sm text-muted-foreground">{followUp.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => handleCreateRequest(followUp)}>
                      Создать обращение
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => startPostpone(followUp)}>
                      Отложить
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => handleDismiss(followUp)}>
                      Не требуется
                    </Button>
                  </div>
                </div>
                {postponingId === followUp.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`postpone-${followUp.id}`} className="text-sm text-muted-foreground">
                      Новая дата
                    </label>
                    <Input
                      id={`postpone-${followUp.id}`}
                      type="date"
                      className="w-44"
                      value={postponeDate}
                      onChange={(e) => setPostponeDate(e.target.value)}
                    />
                    <Button size="sm" disabled={busy || !postponeDate} onClick={() => handlePostpone(followUp)}>
                      Сохранить
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPostponingId(null)}>
                      Отмена
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
      </CardContent>
    </Card>
  )
}
