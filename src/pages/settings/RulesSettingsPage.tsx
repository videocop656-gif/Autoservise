import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type BusinessRuleCategory = 'APPOINTMENT' | 'SERVICE' | 'PAYMENT' | 'WARRANTY' | 'CUSTOMER' | 'OPERATIONS' | 'GENERAL'

interface BusinessRuleDto {
  id: string
  name: string
  description: string
  category: BusinessRuleCategory
  priority: number
  isActive: boolean
}

interface FormState {
  name: string
  description: string
  category: BusinessRuleCategory
  priority: string
}

const EMPTY_FORM: FormState = { name: '', description: '', category: 'GENERAL', priority: '50' }

const CATEGORIES: BusinessRuleCategory[] = ['APPOINTMENT', 'SERVICE', 'PAYMENT', 'WARRANTY', 'CUSTOMER', 'OPERATIONS', 'GENERAL']

const CATEGORY_LABELS: Record<BusinessRuleCategory, string> = {
  APPOINTMENT: 'Запись',
  SERVICE: 'Услуги',
  PAYMENT: 'Оплата',
  WARRANTY: 'Гарантия',
  CUSTOMER: 'Клиенты',
  OPERATIONS: 'Операции',
  GENERAL: 'Общее',
}

type StatusFilter = 'active' | 'inactive' | 'all'

export default function RulesSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [rules, setRules] = useState<BusinessRuleDto[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [categoryFilter, setCategoryFilter] = useState<BusinessRuleCategory | 'ALL'>('ALL')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadRules() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('activeOnly', statusFilter === 'active' ? 'true' : 'false')
      if (categoryFilter !== 'ALL') params.set('category', categoryFilter)
      const data = await apiFetch<{ rules: BusinessRuleDto[] }>(`/api/rules?${params.toString()}`)
      const filtered = statusFilter === 'inactive' ? data.rules.filter((r) => !r.isActive) : data.rules
      setRules(filtered)
    } catch {
      setListError('Не удалось загрузить правила.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(rule: BusinessRuleDto) {
    setEditingId(rule.id)
    setForm({ name: rule.name, description: rule.description, category: rule.category, priority: String(rule.priority) })
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
      name: form.name,
      description: form.description,
      category: form.category,
      priority: Number(form.priority),
    }

    try {
      if (editingId) {
        await apiFetch(`/api/rules/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/rules', { method: 'POST', body: JSON.stringify(payload) })
      }
      closeForm()
      await loadRules()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить правило.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/rules/${id}`, { method: 'DELETE' })
      await loadRules()
    } catch {
      setListError('Не удалось деактивировать правило.')
    }
  }

  return (
    <PageContainer className="max-w-3xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Правила бизнеса</CardTitle>
              <CardDescription>Как ваша команда должна действовать в конкретных ситуациях.</CardDescription>
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
              <div className="flex gap-1">
                {(['active', 'inactive', 'all'] as StatusFilter[]).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? 'default' : 'outline'}
                    onClick={() => setStatusFilter(s)}
                  >
                    {s === 'active' ? 'Active' : s === 'inactive' ? 'Inactive' : 'All'}
                  </Button>
                ))}
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as BusinessRuleCategory | 'ALL')}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="ALL">Все категории</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && rules.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No business rules yet. Add the rules your team follows.
              </p>
            )}

            {rules.map((rule) => (
              <div key={rule.id} className="flex items-start justify-between rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary" title="0 = highest priority, 100 = lowest">
                      P{rule.priority}
                    </span>
                    {rule.name}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[rule.category]}
                    </span>
                    {!rule.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">неактивно</span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{rule.description}</p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(rule)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {rule.isActive && (
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(rule.id)}>
                        Deactivate
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {showForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? 'Редактировать правило' : 'Новое правило'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rule-name">Name</Label>
                  <Input
                    id="rule-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rule-category">Category</Label>
                    <select
                      id="rule-category"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value as BusinessRuleCategory })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rule-priority">Priority (0 = highest, 100 = lowest)</Label>
                    <Input
                      id="rule-priority"
                      type="number"
                      min="0"
                      max="100"
                      required
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    />
                    {fieldErrors.priority && <p className="text-sm text-destructive">{fieldErrors.priority[0]}</p>}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rule-description">Description</Label>
                  <Textarea
                    id="rule-description"
                    required
                    rows={5}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                  {fieldErrors.description && <p className="text-sm text-destructive">{fieldErrors.description[0]}</p>}
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
