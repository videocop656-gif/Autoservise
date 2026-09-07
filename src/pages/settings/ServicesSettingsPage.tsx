import { useEffect, useState, type FormEvent } from 'react'
import { Pencil, Plus } from 'lucide-react'
import Nav from '../../components/Nav'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

interface ServiceDto {
  id: string
  name: string
  description: string | null
  priceFrom: string | null
  priceTo: string | null
  currency: string
  durationMinutes: number
  isActive: boolean
}

interface ServiceFormState {
  name: string
  description: string
  priceFrom: string
  priceTo: string
  durationMinutes: string
}

const EMPTY_FORM: ServiceFormState = { name: '', description: '', priceFrom: '', priceTo: '', durationMinutes: '30' }

function formatPrice(service: ServiceDto): string {
  if (!service.priceFrom && !service.priceTo) return 'По запросу'
  if (service.priceFrom && service.priceTo && service.priceFrom !== service.priceTo) {
    return `${service.priceFrom}–${service.priceTo} ${service.currency}`
  }
  return `${service.priceFrom ?? service.priceTo} ${service.currency}`
}

export default function ServicesSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [services, setServices] = useState<ServiceDto[]>([])
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ServiceFormState>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  async function loadServices() {
    setLoading(true)
    setListError(null)
    try {
      const data = await apiFetch<{ services: ServiceDto[] }>(`/api/services?activeOnly=${showInactive ? 'false' : 'true'}`)
      setServices(data.services)
    } catch {
      setListError('Не удалось загрузить список услуг.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadServices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive])

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFieldErrors({})
    setShowForm(true)
  }

  function openEditForm(service: ServiceDto) {
    setEditingId(service.id)
    setForm({
      name: service.name,
      description: service.description ?? '',
      priceFrom: service.priceFrom ?? '',
      priceTo: service.priceTo ?? '',
      durationMinutes: String(service.durationMinutes),
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
      name: form.name,
      description: form.description === '' ? null : form.description,
      priceFrom: form.priceFrom === '' ? null : Number(form.priceFrom),
      priceTo: form.priceTo === '' ? null : Number(form.priceTo),
      durationMinutes: Number(form.durationMinutes),
    }

    try {
      if (editingId) {
        await apiFetch(`/api/services/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/services', { method: 'POST', body: JSON.stringify(payload) })
      }
      closeForm()
      await loadServices()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setFormError(err.message || 'Проверьте заполненные поля.')
        setFieldErrors(err.fieldErrors)
      } else {
        setFormError('Не удалось сохранить услугу.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(id: string) {
    try {
      await apiFetch(`/api/services/${id}`, { method: 'DELETE' })
      await loadServices()
    } catch {
      setListError('Не удалось деактивировать услугу.')
    }
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Услуги</CardTitle>
              <CardDescription>Каталог услуг вашего автосервиса.</CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add service
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Показать неактивные
            </label>

            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {!loading && services.length === 0 && <p className="text-sm text-muted-foreground">Пока нет услуг.</p>}

            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {service.name}
                    {!service.isActive && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">неактивна</span>
                    )}
                  </div>
                  {service.description && <p className="text-sm text-muted-foreground">{service.description}</p>}
                  <p className="text-sm text-muted-foreground">
                    {formatPrice(service)} · {service.durationMinutes} мин
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditForm(service)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {service.isActive && (
                      <Button variant="outline" size="sm" onClick={() => handleDeactivate(service.id)}>
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
              <CardTitle>{editingId ? 'Редактировать услугу' : 'Новая услуга'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="svc-name">Name</Label>
                  <Input
                    id="svc-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="svc-description">Description</Label>
                  <Textarea
                    id="svc-description"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="svc-price-from">Price from</Label>
                    <Input
                      id="svc-price-from"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.priceFrom}
                      onChange={(e) => setForm({ ...form, priceFrom: e.target.value })}
                    />
                    {fieldErrors.priceFrom && <p className="text-sm text-destructive">{fieldErrors.priceFrom[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="svc-price-to">Price to</Label>
                    <Input
                      id="svc-price-to"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.priceTo}
                      onChange={(e) => setForm({ ...form, priceTo: e.target.value })}
                    />
                    {fieldErrors.priceTo && <p className="text-sm text-destructive">{fieldErrors.priceTo[0]}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="svc-duration">Duration (min)</Label>
                    <Input
                      id="svc-duration"
                      type="number"
                      min="5"
                      max="1440"
                      required
                      value={form.durationMinutes}
                      onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                    />
                    {fieldErrors.durationMinutes && (
                      <p className="text-sm text-destructive">{fieldErrors.durationMinutes[0]}</p>
                    )}
                  </div>
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
