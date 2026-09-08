import { useEffect, useState, type FormEvent } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import Nav from '../../components/Nav'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'

type ConversationStatus = 'OPEN' | 'CLOSED'

interface ConversationDto {
  id: string
  subject: string | null
  status: ConversationStatus
  channel: string
  customerId: string | null
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
}

interface Paginated<T> {
  items: T[]
}

interface AiEntities {
  customerName: string | null
  phone: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  licensePlate: string | null
  serviceName: string | null
  requestedDate: string | null
  requestedTime: string | null
}

/** One check_availability slot — a real, computed slot, never invented (Prompt 10). */
interface AvailabilitySlotDto {
  startAt: string
  endAt: string
  localStart: string
  localEnd: string
}

interface CheckAvailabilityData {
  available: boolean
  date: string
  timezone: string
  slots: AvailabilitySlotDto[]
}

/** Sanitized Appointment DTO — what create_appointment/reschedule_appointment/cancel_appointment return on success. */
interface AppointmentToolData {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: string
  endAt: string
  status: string
  notes: string | null
}

/** One resolved AI tool call — the AI Tool Layer's own result, always one of exactly these two shapes (Prompt 10). */
interface AiToolExecutionSummary {
  tool: string
  success: boolean
  data?: unknown
  errorCode?: string
  message?: string
}

interface AiResultDto {
  intent: string
  confidence: number
  entities: AiEntities
  answer: string
  needsHuman: boolean
  reason: string | null
  /** Present only when at least one real booking tool ran during this analyze call. */
  toolExecutions?: AiToolExecutionSummary[]
  /** Present only when needsHuman === true and a real Escalation row was created or reused (Prompt 12). */
  escalation?: { id: string; status: string }
}

function isCheckAvailabilityData(tool: string, data: unknown): data is CheckAvailabilityData {
  return tool === 'check_availability' && !!data && typeof data === 'object' && 'slots' in data
}

function isAppointmentToolData(tool: string, data: unknown): data is AppointmentToolData {
  return tool !== 'check_availability' && !!data && typeof data === 'object' && 'id' in data && 'status' in data
}

function formatLocalDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

const ENTITY_LABELS: Record<keyof AiEntities, string> = {
  customerName: 'Customer name',
  phone: 'Phone',
  vehicleMake: 'Vehicle make',
  vehicleModel: 'Vehicle model',
  licensePlate: 'License plate',
  serviceName: 'Service',
  requestedDate: 'Requested date',
  requestedTime: 'Requested time',
}

export default function AiSettingsPage() {
  const [conversations, setConversations] = useState<ConversationDto[]>([])
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [conversationId, setConversationId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AiResultDto | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  function customerLabel(id: string | null): string {
    if (!id) return '—'
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : id
  }

  async function loadConversations() {
    setLoading(true)
    setListError(null)
    try {
      const [conversationsResult, customersResult] = await Promise.all([
        apiFetch<Paginated<ConversationDto>>('/api/conversations?pageSize=100'),
        apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100&includeInactive=true'),
      ])
      setConversations(conversationsResult.items)
      setCustomers(customersResult.items)
    } catch {
      setListError('Не удалось загрузить разговоры.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConversations()
  }, [])

  const selectedConversation = conversations.find((c) => c.id === conversationId) ?? null
  const isClosed = selectedConversation?.status === 'CLOSED'

  async function handleAnalyze(e: FormEvent) {
    e.preventDefault()
    setAnalyzeError(null)
    setResult(null)
    setAnalyzing(true)
    try {
      const response = await apiFetch<AiResultDto>('/api/ai/analyze', {
        method: 'POST',
        body: JSON.stringify({ conversationId, message }),
      })
      setResult(response)
    } catch (err) {
      setAnalyzeError(err instanceof ApiClientError ? err.message : 'Не удалось проанализировать сообщение.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Core — Analyze
            </CardTitle>
            <CardDescription>
              Операционный инструмент для проверки AI Core, AI Booking Tools и AI Customer Support: анализ тестового
              сообщения в контексте выбранного разговора, с учётом Service History автомобиля, если он уже известен.
              Отправка сообщения клиенту по-прежнему отключена — ответ модели никогда не создаёт Message и не изменяет
              ServiceRecord/Conversation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-semibold">Внимание: выполнение AI-инструментов реально.</span> Если ответ модели
                вызовет create_appointment, reschedule_appointment или cancel_appointment, это{' '}
                <span className="font-semibold">действительно создаст, перенесёт или отменит</span> запись в базе
                данных этого бизнеса — в отличие от Prompt 09, это не симуляция. check_availability — операция только
                для чтения и ничего не изменяет.
              </div>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}

            {!loading && conversations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Сначала создайте разговор на странице{' '}
                <a href="/settings/conversations" className="underline">
                  Conversations
                </a>
                .
              </p>
            )}

            {!loading && conversations.length > 0 && (
              <form onSubmit={handleAnalyze} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-conversation">Conversation</Label>
                  <select
                    id="ai-conversation"
                    required
                    value={conversationId}
                    onChange={(e) => {
                      setConversationId(e.target.value)
                      setResult(null)
                      setAnalyzeError(null)
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="" disabled>
                      Select a conversation...
                    </option>
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.subject ?? '(без темы)'} · {customerLabel(c.customerId)} · {c.channel} · {c.status}
                      </option>
                    ))}
                  </select>
                  {isClosed && (
                    <p className="text-sm text-destructive">
                      Этот разговор закрыт — анализ невозможен, пока он не будет открыт заново на странице Conversations.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-message">Test message</Label>
                  <Textarea
                    id="ai-message"
                    required
                    maxLength={4000}
                    placeholder="Например: Сколько стоит замена масла?"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>

                {analyzeError && <p className="text-sm text-destructive">{analyzeError}</p>}

                <Button type="submit" disabled={analyzing || isClosed || !conversationId}>
                  {analyzing ? 'Analyzing...' : 'Analyze'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
              <CardDescription>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  Draft only — message was not sent.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Intent</div>
                  <div className="font-medium">{result.intent}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Confidence</div>
                  <div className="font-medium">{(result.confidence * 100).toFixed(0)}%</div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-sm text-muted-foreground">Extracted entities</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
                  {(Object.keys(ENTITY_LABELS) as (keyof AiEntities)[]).map((key) => (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{ENTITY_LABELS[key]}</span>
                      <span className="font-medium">{result.entities[key] ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {result.toolExecutions && result.toolExecutions.length > 0 && (
                <div>
                  <div className="mb-1 text-sm text-muted-foreground">
                    Tool executions <span className="font-medium text-amber-700">(real — see warning above)</span>
                  </div>
                  <div className="space-y-2">
                    {result.toolExecutions.map((exec, idx) => (
                      <div key={idx} className="rounded-md border p-3 text-sm">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800">
                            {exec.tool}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                              exec.success ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {exec.success ? 'success' : 'failed'}
                          </span>
                        </div>

                        {!exec.success && (
                          <div className="space-y-0.5">
                            <div>
                              <span className="text-muted-foreground">Error code: </span>
                              <span className="font-mono">{exec.errorCode}</span>
                            </div>
                            {exec.message && <div className="text-muted-foreground">{exec.message}</div>}
                          </div>
                        )}

                        {exec.success && isCheckAvailabilityData(exec.tool, exec.data) && (
                          <div className="space-y-1">
                            <div>
                              <span className="text-muted-foreground">Date: </span>
                              {exec.data.date} <span className="text-muted-foreground">({exec.data.timezone})</span>
                            </div>
                            {exec.data.slots.length === 0 ? (
                              <div className="text-muted-foreground">No available slots.</div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {exec.data.slots.map((slot, slotIdx) => (
                                  <span key={slotIdx} className="rounded border bg-muted/50 px-2 py-0.5 font-mono text-xs">
                                    {slot.localStart}–{slot.localEnd}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {exec.success && isAppointmentToolData(exec.tool, exec.data) && (
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <div>
                              <span className="text-muted-foreground">Appointment: </span>
                              <span className="font-mono">{exec.data.id}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Status: </span>
                              <span className="font-medium">{exec.data.status}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Start: </span>
                              {formatLocalDateTime(exec.data.startAt)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">End: </span>
                              {formatLocalDateTime(exec.data.endAt)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-sm text-muted-foreground">Draft answer</div>
                <div className="rounded-md border bg-muted/50 p-3 text-sm">{result.answer}</div>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    result.needsHuman ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {result.needsHuman ? 'Needs human' : 'Confident'}
                </span>
                {result.reason && <span className="text-muted-foreground">{result.reason}</span>}
              </div>

              {result.escalation && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <span className="font-semibold">Real escalation (Prompt 12):</span> a real, tenant-isolated Escalation
                  row was created or reused for this conversation — status <span className="font-mono">{result.escalation.status}</span>.
                  See it on{' '}
                  <a href="/settings/escalations" className="underline">
                    Escalations
                  </a>
                  .
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
