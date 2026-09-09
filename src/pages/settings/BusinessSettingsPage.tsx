import { useEffect, useState, type FormEvent } from 'react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth, type AuthBusiness } from '../../context/AuthContext'

const CURRENCIES = ['RUB', 'KZT', 'USD', 'EUR'] as const

type FormState = {
  name: string
  description: string
  phone: string
  email: string
  address: string
  timezone: string
  website: string
  currency: string
}

function toFormState(business: AuthBusiness): FormState {
  return {
    name: business.name,
    description: business.description ?? '',
    phone: business.phone ?? '',
    email: business.email ?? '',
    address: business.address ?? '',
    timezone: business.timezone,
    website: business.website ?? '',
    currency: business.currency,
  }
}

export default function BusinessSettingsPage() {
  const { user, business, refresh } = useAuth()
  const canEdit = user?.role === 'owner' || user?.role === 'admin'

  const [form, setForm] = useState<FormState | null>(business ? toFormState(business) : null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (business) setForm(toFormState(business))
  }, [business])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    setFieldErrors({})
    setSuccess(false)
    setSaving(true)
    try {
      await apiFetch('/api/business', {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      await refresh()
      setSuccess(true)
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message || 'Не удалось сохранить изменения.')
        setFieldErrors(err.fieldErrors)
      } else {
        setError('Не удалось сохранить изменения.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (!form) {
    return <PageContainer className="text-sm text-muted-foreground">Загрузка...</PageContainer>
  }

  return (
    <PageContainer className="max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Профиль автосервиса</CardTitle>
            <CardDescription>
              {canEdit ? 'Основная информация о вашем автосервисе.' : 'Просмотр профиля (изменение доступно owner/admin).'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Название</Label>
                <Input id="name" disabled={!canEdit} value={form.name} onChange={(e) => update('name', e.target.value)} />
                {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name[0]}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Описание</Label>
                <Textarea
                  id="description"
                  disabled={!canEdit}
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                />
                {fieldErrors.description && <p className="text-sm text-destructive">{fieldErrors.description[0]}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Телефон</Label>
                  <Input id="phone" disabled={!canEdit} value={form.phone} onChange={(e) => update('phone', e.target.value)} />
                  {fieldErrors.phone && <p className="text-sm text-destructive">{fieldErrors.phone[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    disabled={!canEdit}
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                  {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email[0]}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Адрес</Label>
                <Input id="address" disabled={!canEdit} value={form.address} onChange={(e) => update('address', e.target.value)} />
                {fieldErrors.address && <p className="text-sm text-destructive">{fieldErrors.address[0]}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Часовой пояс (IANA)</Label>
                  <Input
                    id="timezone"
                    placeholder="Europe/Moscow"
                    disabled={!canEdit}
                    value={form.timezone}
                    onChange={(e) => update('timezone', e.target.value)}
                  />
                  {fieldErrors.timezone && <p className="text-sm text-destructive">{fieldErrors.timezone[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Валюта</Label>
                  <select
                    id="currency"
                    disabled={!canEdit}
                    value={form.currency}
                    onChange={(e) => update('currency', e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.currency && <p className="text-sm text-destructive">{fieldErrors.currency[0]}</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Сайт</Label>
                <Input
                  id="website"
                  placeholder="https://example.com"
                  disabled={!canEdit}
                  value={form.website}
                  onChange={(e) => update('website', e.target.value)}
                />
                {fieldErrors.website && <p className="text-sm text-destructive">{fieldErrors.website[0]}</p>}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-green-600">Изменения сохранены.</p>}

              {canEdit && (
                <Button type="submit" disabled={saving}>
                  {saving ? 'Сохранение...' : 'Save changes'}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
    </PageContainer>
  )
}
