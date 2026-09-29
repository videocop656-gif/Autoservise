import { useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Badge } from '../ui/badge'
import { apiFetch } from '../../lib/apiClient'
import { utcToZonedParts } from '../../lib/businessTime'
import { vehicleLabel } from '../clients/shared'
import {
  FOLLOW_UP_BUCKET_LABELS,
  followUpBucket,
  followUpDueDateStr,
  formatFollowUpDueDate,
  type ServiceFollowUpDto,
} from './shared'

interface NextFollowUpSectionProps {
  /** Exactly one of customerId / vehicleId: whose next contact to show. */
  customerId?: string
  vehicleId?: string
  timezone: string
  /** For the vehicle label — only shown on Client Detail, where a customer can have several. */
  vehicles?: { id: string; make: string; model: string; year: number | null }[]
  services: { id: string; name: string }[]
}

/**
 * Prompt 48 — "Следующий контакт" on Client Detail / Vehicle Detail: the
 * nearest PENDING follow-up only. CONTACTED/BOOKED/DISMISSED ones are
 * already handled and never count as the next contact. The server does the
 * ordering (dueAt ASC), so pageSize=1 is the nearest one.
 */
export function NextFollowUpSection({ customerId, vehicleId, timezone, vehicles, services }: NextFollowUpSectionProps) {
  const [followUp, setFollowUp] = useState<ServiceFollowUpDto | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ status: 'PENDING', pageSize: '1' })
    if (customerId) params.set('customerId', customerId)
    if (vehicleId) params.set('vehicleId', vehicleId)
    apiFetch<{ items: ServiceFollowUpDto[] }>(`/api/follow-ups?${params.toString()}`)
      .then((result) => {
        if (cancelled) return
        setFollowUp(result.items[0] ?? null)
        setError(false)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, vehicleId])

  const todayDateStr = utcToZonedParts(new Date(), timezone).dateStr
  const vehicle = followUp && vehicles ? vehicles.find((v) => v.id === followUp.vehicleId) : undefined
  const service = followUp?.serviceId ? services.find((s) => s.id === followUp.serviceId) : undefined
  const bucket = followUp ? followUpBucket(followUpDueDateStr(followUp.dueAt, timezone), todayDateStr) : null

  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        Следующий контакт
      </h3>
      {error && <p className="text-sm text-destructive">Не удалось загрузить следующий контакт</p>}
      {!error && loaded && !followUp && <p className="text-sm text-muted-foreground">Следующий контакт не запланирован</p>}
      {!error && followUp && bucket && (
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{formatFollowUpDueDate(followUp.dueAt, timezone)}</span>
            {bucket !== 'upcoming' && (
              <Badge variant={bucket === 'overdue' ? 'destructive' : 'gold'}>{FOLLOW_UP_BUCKET_LABELS[bucket]}</Badge>
            )}
          </div>
          {vehicle && <p className="text-muted-foreground">{vehicleLabel(vehicle)}</p>}
          <p className="text-muted-foreground">{service ? service.name : 'Без услуги'}</p>
          {followUp.note && <p className="text-muted-foreground">{followUp.note}</p>}
        </div>
      )}
    </section>
  )
}
