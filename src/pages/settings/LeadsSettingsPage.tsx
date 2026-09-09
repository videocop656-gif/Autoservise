import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type LeadStatus = 'NEW' | 'IN_PROGRESS' | 'QUALIFIED' | 'WON' | 'LOST'
type LeadSource = 'MANUAL' | 'WEBSITE' | 'PHONE' | 'OTHER'

interface LeadDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  status: LeadStatus
  source: LeadSource
  subject: string
  description: string | null
  notes: string | null
  createdAt: string
}

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
}

interface VehicleDto {
  id: string
  customerId: string
  make: string
  model: string
  licensePlate: string | null
}

interface ServiceDto {
  id: string
  name: string
}

interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface FormState {
  customerId: string
  vehicleId: string
  serviceId: string
  subject: string
  description: string
  notes: string
  status: LeadStatus
  source: LeadSource
}

const EMPTY_FORM: FormState = {
  customerId: '',
  vehicleId: '',
  serviceId: '',
  subject: '',
  description: '',
  notes: '',
  status: 'NEW',
  source: 'MANUAL',
}

const STATUSES: LeadStatus[] = ['NEW', 'IN_PROGRESS', 'QUALIFIED', 'WON', 'LOST']
const SOURCES: LeadSource[] = ['MANUAL', 'WEBSITE', 'PHONE', 'OTHER']

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Новое',
  IN_PROGRESS: 'В работе',
  QUALIFIED: 'Квалифицировано',
  WON: 'Успешно',
  LOST: 'Потеряно',
}

export default function LeadsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [data, setData] = useState<Paginated<LeadDto> | null>(null)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [services, setServices] = useState<ServiceDto[]>([])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('')
  const [sourceFilter, setSourceFilter] = useState<LeadSource | ''>('')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  function customerLabel(id: string): string {
    const c = customers.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : id
  }

  function vehicleLabel(id: string | null): string {
    if (!id) return '—'
    const v = vehicles.find((x) => x.id === id)
    return v ? `${v.make} ${v.model}${v.licensePlate ? ` (${v.licensePlate})` : ''}` : id
  }

  async function loadReferenceData() {
    try {
      const [customersResult, vehiclesResult, servicesResult] = await Promise.all([
        apiFetch<Paginated<CustomerDto>>('/api/customers?pageSize=100'),
        apiFetch<Paginated<VehicleDto>>('/api/vehicles?pageSize=100'),
        apiFetch<{ services: ServiceDto[] }>('/api/services'),
      ])
      setCustomers(customersResult.items)
      setVehicles(vehiclesResult.items)
      setServices(servicesResult.services)
    } catch {
      // Non-fatal: the lead list still works, just shows raw ids as a fallback.
    }
  }

  async function loadLeads() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (statusFilter) params.set('status', statusFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      const result = await apiFetch<Paginated<LeadDto>>(`/api/leads?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить обращения.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReferenceData()
  }, [])

  useEffect(() => {
    void loadLeads()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, sourceFilter])

  useEffect(() => {
    setPage(1)
  }, [statusFilter, sourceFilter])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(lead: LeadDto) {
    setEditingId(lead.id)
    setForm({
      customerId: lead.customerId,
      vehicleId: lead.vehicleId ?? '',
      serviceId: lead.serviceId ?? '',
      subject: lead.subject,
      description: lead.description ?? '',
      notes: lead.notes ?? '',
      status: lead.status,
      source: lead.source,
    })
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFieldErrors({})
    setSaving(true)

    const payload = {
      customerId: form.customerId,
      vehicleId: form.vehicleId === '' ? null : form.vehicleId,
      serviceId: form.serviceId === '' ? null : form.serviceId,
      subject: form.subject,
      description: form.description === '' ? null : form.description,
      notes: form.notes === '' ? null : form.notes,
      status: form.status,
      source: form.source,
    }

    try {
      if (editingId) {
        await apiFetch(`/api/leads/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify(payload) })
      }
      closeForm()
      await loadLeads()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить обращение.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleQuickStatusChange(lead: LeadDto, status: LeadStatus) {
    try {
      await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadLeads()
    } catch {
      setListError('Не удалось изменить статус.')
    }
  }

  const customerVehicles = vehicles.filter((v) => v.customerId === form.customerId)

  return (
    <PageContainer className="max-w-4xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Обращения (Leads)</CardTitle>
              <CardDescription>Обращения клиентов и потенциальных клиентов.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm} disabled={customers.length === 0}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as LeadStatus | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все статусы</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as LeadSource | '')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">Все источники</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && <p className="text-sm text-muted-foreground">Обращений пока нет.</p>}

            {data?.items.map((lead) => (
              <div key={lead.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-medium">{lead.subject}</div>
                  <p className="text-sm text-muted-foreground">
                    {customerLabel(lead.customerId)} · {vehicleLabel(lead.vehicleId)} · {lead.source} ·{' '}
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canManage ? (
                    <select
                      value={lead.status}
                      onChange={(e) => handleQuickStatusChange(lead, e.target.value as LeadStatus)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {STATUS_LABELS[lead.status]}
                    </span>
                  )}
                  {canManage && (
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(lead)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {showForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? 'Редактировать обращение' : 'Новое обращение'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lead-customer">Customer</Label>
                    <select
                      id="lead-customer"
                      required
                      value={form.customerId}
                      onChange={(e) => setForm({ ...form, customerId: e.target.value, vehicleId: '' })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="" disabled>
                        Select a customer...
                      </option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.firstName} {c.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lead-vehicle">Vehicle (optional)</Label>
                    <select
                      id="lead-vehicle"
                      value={form.vehicleId}
                      onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      <option value="">None</option>
                      {customerVehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.make} {v.model} {v.licensePlate ? `(${v.licensePlate})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lead-service">Service (optional)</Label>
                  <select
                    id="lead-service"
                    value={form.serviceId}
                    onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  >
                    <option value="">None</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lead-subject">Subject</Label>
                  <Input
                    id="lead-subject"
                    required
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  />
                  {fieldErrors.subject && <p className="text-sm text-destructive">{fieldErrors.subject[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lead-description">Description</Label>
                  <Textarea
                    id="lead-description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="lead-status">Status</Label>
                    <select
                      id="lead-status"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as LeadStatus })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lead-source">Source</Label>
                    <select
                      id="lead-source"
                      value={form.source}
                      onChange={(e) => setForm({ ...form, source: e.target.value as LeadSource })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {SOURCES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lead-notes">Notes</Label>
                  <Textarea id="lead-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>

                {formError && <p className="text-sm text-destructive">{formError}</p>}

                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Сохранение...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeForm}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
    </PageContainer>
  )
}
