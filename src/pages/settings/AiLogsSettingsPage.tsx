import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import Nav from '../../components/Nav'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch } from '../../lib/apiClient'

type AiLogOperation =
  | 'AI_ANALYZE'
  | 'AI_TOOL_EXECUTION'
  | 'AI_ESCALATION_CREATE'
  | 'AI_ESCALATION_REUSE'
  | 'AI_ESCALATION_CLAIM'
  | 'AI_ESCALATION_RESOLVE'
  | 'AI_ESCALATION_CANCEL'

type AiLogOutcome = 'SUCCESS' | 'ESCALATED' | 'REUSED' | 'FAILED' | 'REJECTED' | 'NO_ACTION'

// Safe fields only — this DTO mirrors toAiLogDto() exactly. There is no
// raw prompt, no raw provider response, and no chain-of-thought to show
// here because none of that is ever persisted in the first place.
interface AiLogDto {
  id: string
  operation: AiLogOperation
  outcome: AiLogOutcome
  conversationId: string | null
  messageId: string | null
  escalationId: string | null
  intent: string | null
  confidence: number | null
  needsHuman: boolean | null
  reason: string | null
  toolName: string | null
  toolSuccess: boolean | null
  createdAt: string
  actor?: { id: string; name: string } | null
  metadata?: Record<string, unknown> | null
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const OPERATIONS: AiLogOperation[] = [
  'AI_ANALYZE',
  'AI_TOOL_EXECUTION',
  'AI_ESCALATION_CREATE',
  'AI_ESCALATION_REUSE',
  'AI_ESCALATION_CLAIM',
  'AI_ESCALATION_RESOLVE',
  'AI_ESCALATION_CANCEL',
]

const OUTCOMES: AiLogOutcome[] = ['SUCCESS', 'ESCALATED', 'REUSED', 'FAILED', 'REJECTED', 'NO_ACTION']

const OUTCOME_COLORS: Record<AiLogOutcome, string> = {
  SUCCESS: 'bg-emerald-100 text-emerald-800',
  ESCALATED: 'bg-amber-100 text-amber-800',
  REUSED: 'bg-slate-100 text-slate-700',
  FAILED: 'bg-red-100 text-red-800',
  REJECTED: 'bg-red-100 text-red-800',
  NO_ACTION: 'bg-muted text-muted-foreground',
}

// This is a technical audit trail (Prompt 13), not a Dashboard/Analytics
// page (that's Roadmap 14) — no charts, no aggregates, just a filterable,
// paginated list plus a safe detail panel. Owner/admin/manager access only,
// enforced server-side by aiLogService.ts regardless of what this page shows.
export default function AiLogsSettingsPage() {
  const [data, setData] = useState<Paginated<AiLogDto> | null>(null)
  const [page, setPage] = useState(1)
  const [operationFilter, setOperationFilter] = useState<AiLogOperation | ''>('')
  const [outcomeFilter, setOutcomeFilter] = useState<AiLogOutcome | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AiLogDto | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function loadLogs() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (operationFilter) params.set('operation', operationFilter)
      if (outcomeFilter) params.set('outcome', outcomeFilter)
      if (dateFrom) params.set('dateFrom', new Date(dateFrom).toISOString())
      if (dateTo) params.set('dateTo', new Date(dateTo).toISOString())
      const result = await apiFetch<Paginated<AiLogDto>>(`/api/ai-logs?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить журнал AI.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, operationFilter, outcomeFilter, dateFrom, dateTo])

  useEffect(() => {
    setPage(1)
  }, [operationFilter, outcomeFilter, dateFrom, dateTo])

  async function loadDetail(id: string) {
    setDetailError(null)
    try {
      const result = await apiFetch<{ log: AiLogDto }>(`/api/ai-logs/${id}`)
      setDetail(result.log)
    } catch {
      setDetailError('Не удалось загрузить запись журнала.')
    }
  }

  function openDetail(id: string) {
    setOpenId(id)
    setDetail(null)
    void loadDetail(id)
  }

  function closeDetail() {
    setOpenId(null)
    setDetail(null)
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="h-5 w-5" />
              AI Logs
            </CardTitle>
            <CardDescription>
              Технический аудит действий AI и сотрудников: анализ сообщений, вызовы инструментов бронирования и
              обработка эскалаций. Это не история переписки и не аналитика — только безопасный, минимальный след
              того, что фактически произошло. Сырые ответы модели и цепочки рассуждений здесь никогда не хранятся.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={operationFilter}
                onChange={(e) => setOperationFilter(e.target.value as AiLogOperation | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все операции</option>
                {OPERATIONS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value as AiLogOutcome | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все результаты</option>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                От
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                До
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                />
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Записей пока нет.</p>}

            {data?.items.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {log.operation}
                    {log.toolName ? ` · ${log.toolName}` : ''}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                    {log.intent ? ` · ${log.intent}` : ''}
                    {log.confidence !== null ? ` · confidence ${log.confidence.toFixed(2)}` : ''}
                    {log.needsHuman ? ' · needsHuman' : ''}
                  </p>
                  {log.reason && <p className="truncate text-sm text-muted-foreground">{log.reason}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${OUTCOME_COLORS[log.outcome]}`}>{log.outcome}</span>
                  <Button variant="outline" size="sm" onClick={() => openDetail(log.id)}>
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
                <CardTitle>Запись журнала</CardTitle>
                <CardDescription>{detail ? `${detail.operation} · ${detail.outcome}` : 'Загрузка...'}</CardDescription>
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
                      <div className="text-muted-foreground">Создана</div>
                      <div className="font-medium">{new Date(detail.createdAt).toLocaleString()}</div>
                    </div>
                    {detail.intent && (
                      <div>
                        <div className="text-muted-foreground">Intent</div>
                        <div className="font-medium">{detail.intent}</div>
                      </div>
                    )}
                    {detail.confidence !== null && (
                      <div>
                        <div className="text-muted-foreground">Confidence</div>
                        <div className="font-medium">{detail.confidence!.toFixed(2)}</div>
                      </div>
                    )}
                    {detail.toolName && (
                      <div>
                        <div className="text-muted-foreground">Tool</div>
                        <div className="font-medium">
                          {detail.toolName} {detail.toolSuccess === false ? '(failed)' : ''}
                        </div>
                      </div>
                    )}
                    {detail.actor && (
                      <div>
                        <div className="text-muted-foreground">Сотрудник</div>
                        <div className="font-medium">{detail.actor.name}</div>
                      </div>
                    )}
                  </div>

                  {detail.reason && (
                    <div>
                      <div className="mb-1 text-sm text-muted-foreground">Причина</div>
                      <div className="rounded-md border bg-muted/50 p-3 text-sm">{detail.reason}</div>
                    </div>
                  )}

                  {detail.metadata && Object.keys(detail.metadata).length > 0 && (
                    <div>
                      <div className="mb-1 text-sm text-muted-foreground">Метаданные (безопасные, whitelisted)</div>
                      <div className="rounded-md border bg-muted/50 p-3 text-sm">
                        {Object.entries(detail.metadata).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-muted-foreground">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 text-sm">
                    {detail.conversationId && (
                      <a href="/settings/conversations" className="underline">
                        Conversation
                      </a>
                    )}
                    {detail.escalationId && (
                      <a href="/settings/escalations" className="underline">
                        Escalation
                      </a>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
