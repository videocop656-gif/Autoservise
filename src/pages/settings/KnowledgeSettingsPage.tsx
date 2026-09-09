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

type KnowledgeCategory = 'FAQ' | 'SERVICE_INFO' | 'POLICY' | 'WARRANTY' | 'PAYMENT' | 'PREPARATION' | 'GENERAL'

interface KnowledgeItemDto {
  id: string
  title: string
  content: string
  category: KnowledgeCategory
  isActive: boolean
}

interface FormState {
  title: string
  content: string
  category: KnowledgeCategory
}

const EMPTY_FORM: FormState = { title: '', content: '', category: 'GENERAL' }

const CATEGORIES: KnowledgeCategory[] = ['FAQ', 'SERVICE_INFO', 'POLICY', 'WARRANTY', 'PAYMENT', 'PREPARATION', 'GENERAL']

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  FAQ: 'FAQ',
  SERVICE_INFO: 'Об услугах',
  POLICY: 'Политика',
  WARRANTY: 'Гарантия',
  PAYMENT: 'Оплата',
  PREPARATION: 'Подготовка',
  GENERAL: 'Общее',
}

type StatusFilter = 'active' | 'inactive' | 'all'

export default function KnowledgeSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [items, setItems] = useState<KnowledgeItemDto[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [categoryFilter, setCategoryFilter] = useState<KnowledgeCategory | 'ALL'>('ALL')
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadItems() {
    setLoading(true)
    setListError(null)
    try {
      const params = new URLSearchParams()
      params.set('activeOnly', statusFilter === 'active' ? 'true' : 'false')
      if (categoryFilter !== 'ALL') params.set('category', categoryFilter)
      const data = await apiFetch<{ items: KnowledgeItemDto[] }>(`/api/knowledge?${params.toString()}`)
      const filtered = statusFilter === 'inactive' ? data.items.filter((i) => !i.isActive) : data.items
      setItems(filtered)
    } catch {
      setListError('Не удалось загрузить базу знаний.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(item: KnowledgeItemDto) {
    setEditingId(item.id)
    setForm({ title: item.title, content: item.content, category: item.category })
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
        await apiFetch(`/api/knowledge/${editingId}`, { method: 'PATCH', body: JSON.stringify(form) })
      } else {
        await apiFetch('/api/knowledge', { method: 'POST', body: JSON.stringify(form) })
      }
      closeForm()
      await loadItems()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить запись.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/knowledge/${id}`, { method: 'DELETE' })
      await loadItems()
    } catch {
      setListError('Не удалось деактивировать запись.')
    }
  }

  return (
    <PageContainer className="max-w-3xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>База знаний</CardTitle>
              <CardDescription>Информация, которую в будущем сможет использовать AI-администратор.</CardDescription>
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
                onChange={(e) => setCategoryFilter(e.target.value as KnowledgeCategory | 'ALL')}
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
            {!loading && items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No knowledge items yet. Add your first business information.
              </p>
            )}

            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {item.title}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    {!item.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">неактивна</span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{item.content}</p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(item)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {item.isActive && (
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(item.id)}>
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
              <CardTitle>{editingId ? 'Редактировать запись' : 'Новая запись'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="kb-title">Title</Label>
                  <Input
                    id="kb-title"
                    required
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                  {fieldErrors.title && <p className="text-sm text-destructive">{fieldErrors.title[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="kb-category">Category</Label>
                  <select
                    id="kb-category"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as KnowledgeCategory })}
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
                  <Label htmlFor="kb-content">Content</Label>
                  <Textarea
                    id="kb-content"
                    required
                    rows={5}
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                  />
                  {fieldErrors.content && <p className="text-sm text-destructive">{fieldErrors.content[0]}</p>}
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
