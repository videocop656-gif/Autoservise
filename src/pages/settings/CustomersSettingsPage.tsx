import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import Nav from '../../components/Nav'
import Pagination from '../../components/Pagination'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
  phone: string
  email: string | null
  notes: string | null
  isActive: boolean
}

interface PaginatedCustomers {
  items: CustomerDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface FormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  notes: string
}

const EMPTY_FORM: FormState = { firstName: '', lastName: '', phone: '', email: '', notes: '' }

export default function CustomersSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [data, setData] = useState<PaginatedCustomers | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadCustomers() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (search) params.set('search', search)
      if (includeInactive) params.set('includeInactive', 'true')
      const result = await apiFetch<PaginatedCustomers>(`/api/customers?${params.toString()}`)
      setData(result)
    } catch {
      setListError('Не удалось загрузить клиентов.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCustomers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, includeInactive])

  useEffect(() => {
    setPage(1)
  }, [search, includeInactive])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(customer: CustomerDto) {
    setEditingId(customer.id)
    setForm({
      firstName: customer.firstName,
      lastName: customer.lastName ?? '',
      phone: customer.phone,
      email: customer.email ?? '',
      notes: customer.notes ?? '',
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
    try {
      if (editingId) {
        await apiFetch(`/api/customers/${editingId}`, { method: 'PATCH', body: JSON.stringify(form) })
      } else {
        await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(form) })
      }
      closeForm()
      await loadCustomers()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить клиента.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/customers/${id}`, { method: 'DELETE' })
      await loadCustomers()
    } catch {
      setListError('Не удалось деактивировать клиента.')
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Клиенты</CardTitle>
              <CardDescription>База клиентов автосервиса.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search customers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                Показать неактивных
              </label>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">Клиентов пока нет.</p>
            )}

            {data?.items.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {customer.firstName} {customer.lastName}
                    {!customer.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">неактивен</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {customer.phone}
                    {customer.email ? ` · ${customer.email}` : ''}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(customer)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {customer.isActive && (
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(customer.id)}>
                        Deactivate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {data && <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />}
          </CardContent>
        </Card>

        {showForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? 'Редактировать клиента' : 'Новый клиент'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cust-first">First name</Label>
                    <Input
                      id="cust-first"
                      required
                      value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    />
                    {fieldErrors.firstName && <p className="text-sm text-destructive">{fieldErrors.firstName[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cust-last">Last name</Label>
                    <Input
                      id="cust-last"
                      value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cust-phone">Phone</Label>
                    <Input
                      id="cust-phone"
                      required
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                    {fieldErrors.phone && <p className="text-sm text-destructive">{fieldErrors.phone[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cust-email">Email</Label>
                    <Input
                      id="cust-email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                    {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cust-notes">Notes</Label>
                  <Textarea id="cust-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
      </div>
    </div>
  )
}
