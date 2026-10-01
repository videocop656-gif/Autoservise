import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, Plus, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import type { ConversationDto, CustomerRefDto, VehicleRefDto, Paginated } from './shared'
import {
  intakeErrorMessage,
  phoneMatchesFrom,
  personName,
  canChangeCustomer,
  identityMismatch,
  vehicleTitle,
  type IntakeAction,
  type PhoneMatch,
} from './intake'

// ---------------------------------------------------------------------------
// Prompt 54 — "Клиент и автомобиль" in Conversation Detail. Operator-only
// intake: find & link an existing customer, create one (with a same-phone
// duplicate check), see the customer's stored vehicles and add one. Every
// rule is enforced by the server (POST /api/conversations/:id/customer and
// …/vehicles); nothing is created or linked automatically, nothing is sent.
//
// The UI only shows what is stored: the conversation's customer
// (Conversation.customerId) and that customer's vehicles. Which vehicle a
// piece of work is about is chosen when the request is created (Prompt 49,
// CustomerRequest.vehicleId) — the request's vehicle is marked here, and no
// "selected vehicle" is pretended to be saved on the conversation.
// ---------------------------------------------------------------------------

export interface ConversationIdentitySectionProps {
  detail: ConversationDto
  /** owner/admin/manager — may link a customer (same as other conversation actions). */
  canManage: boolean
  /** owner/admin — may create customers and vehicles (same as the Clients/Vehicles screens). */
  canCreate: boolean
  onChanged: () => void
}

type Panel = 'none' | 'search' | 'create-customer' | 'add-vehicle'

const EMPTY_CUSTOMER = { firstName: '', lastName: '', phone: '', email: '' }
const EMPTY_VEHICLE = { make: '', model: '', year: '', licensePlate: '', vin: '' }

export function ConversationIdentitySection({ detail, canManage, canCreate, onChanged }: ConversationIdentitySectionProps) {
  const navigate = useNavigate()
  const customer = detail.customer ?? null
  const requestVehicleId = detail.customerRequest?.vehicleId ?? null
  const identity = { customerRequestId: detail.customerRequestId, customerId: detail.customerId, requestCustomerId: detail.customerRequest?.customerId ?? null }
  const change = canChangeCustomer(identity)

  const [panel, setPanel] = useState<Panel>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CustomerRefDto[]>([])
  const [searching, setSearching] = useState(false)
  const [confirmCustomer, setConfirmCustomer] = useState<{ id: string; name: string } | null>(null)

  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER)
  const [phoneMatches, setPhoneMatches] = useState<PhoneMatch[]>([])

  const [vehicleForm, setVehicleForm] = useState(EMPTY_VEHICLE)
  const [vehicles, setVehicles] = useState<VehicleRefDto[]>([])
  const [vehiclesError, setVehiclesError] = useState(false)
  // Never show "no vehicles" before the list has actually loaded.
  const [vehiclesLoading, setVehiclesLoading] = useState(false)
  const [vehiclesKey, setVehiclesKey] = useState(0)

  function openPanel(next: Panel) {
    setPanel(next)
    setError(null)
    setPhoneMatches([])
    setConfirmCustomer(null)
    if (next === 'search') {
      setQuery('')
      setResults([])
    }
    if (next === 'create-customer') setCustomerForm(EMPTY_CUSTOMER)
    if (next === 'add-vehicle') setVehicleForm(EMPTY_VEHICLE)
  }

  // Reset when another conversation is opened in the same panel.
  useEffect(() => {
    setPanel('none')
    setError(null)
  }, [detail.id])

  // The linked customer's stored, active vehicles.
  useEffect(() => {
    if (!detail.customerId) {
      setVehicles([])
      return
    }
    let cancelled = false
    setVehiclesError(false)
    setVehiclesLoading(true)
    setVehicles([]) // never show the previous customer's vehicles under a new customer
    apiFetch<Paginated<VehicleRefDto>>(`/api/vehicles?customerId=${detail.customerId}&pageSize=20`).then(
      (r) => {
        if (cancelled) return
        setVehicles(r.items)
        setVehiclesLoading(false)
      },
      () => {
        if (cancelled) return
        setVehiclesError(true)
        setVehiclesLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [detail.customerId, vehiclesKey])

  // Existing customer search (GET /api/customers?search= — name, phone, email; this business only).
  useEffect(() => {
    if (panel !== 'search') return
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      apiFetch<Paginated<CustomerRefDto>>(`/api/customers?search=${encodeURIComponent(q)}&pageSize=8`).then(
        (r) => {
          if (cancelled) return
          setResults(r.items)
          setSearching(false)
        },
        () => {
          if (cancelled) return
          setError('Не удалось выполнить поиск.')
          setSearching(false)
        }
      )
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [panel, query])

  function fail(action: IntakeAction, err: unknown) {
    if (err instanceof ApiClientError) {
      setError(intakeErrorMessage(action, err.code, err.message))
      if (err.code === 'CUSTOMER_PHONE_EXISTS') setPhoneMatches(phoneMatchesFrom(err.fieldErrors))
    } else {
      setError(intakeErrorMessage(action, undefined, undefined))
    }
  }

  async function link(customerId: string) {
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/api/conversations/${detail.id}/customer`, {
        method: 'POST',
        body: JSON.stringify({ action: 'link', customerId, expectedCustomerId: detail.customerId }),
      })
      openPanel('none')
      onChanged()
    } catch (err) {
      fail('link', err)
    } finally {
      setBusy(false)
    }
  }

  function chooseCustomer(c: { id: string; firstName: string; lastName: string | null }) {
    // Replacing an existing customer needs an explicit second click.
    if (detail.customerId && detail.customerId !== c.id) {
      setConfirmCustomer({ id: c.id, name: personName(c) })
      return
    }
    void link(c.id)
  }

  async function handleCreateCustomer(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setPhoneMatches([])
    try {
      await apiFetch(`/api/conversations/${detail.id}/customer`, {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          customer: {
            firstName: customerForm.firstName,
            lastName: customerForm.lastName || null,
            phone: customerForm.phone,
            email: customerForm.email || null,
          },
        }),
      })
      openPanel('none')
      onChanged()
    } catch (err) {
      fail('create-customer', err)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddVehicle(e: FormEvent) {
    e.preventDefault()
    const year = vehicleForm.year.trim()
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/api/conversations/${detail.id}/vehicles`, {
        method: 'POST',
        body: JSON.stringify({
          make: vehicleForm.make,
          model: vehicleForm.model,
          year: year === '' ? null : Number(year),
          licensePlate: vehicleForm.licensePlate || null,
          vin: vehicleForm.vin || null,
        }),
      })
      openPanel('none')
      setVehiclesKey((k) => k + 1)
      onChanged()
    } catch (err) {
      fail('create-vehicle', err)
    } finally {
      setBusy(false)
    }
  }

  const heading = <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Клиент и автомобиль</h3>

  return (
    <section data-testid="conversation-identity" className="space-y-2">
      {heading}

      {identityMismatch(identity) && (
        <p className="flex items-start gap-1 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Клиент диалога не совпадает с клиентом обращения — проверьте данные.
        </p>
      )}

      {/* ---- Customer ---- */}
      {customer ? (
        <div className="text-sm">
          <button type="button" onClick={() => navigate(`/clients?open=${customer.id}`)} className="block w-full rounded-md text-left hover:underline">
            <div className="font-medium">{personName(customer)}</div>
            {customer.phone && <div className="text-muted-foreground">{customer.phone}</div>}
            {customer.email && <div className="text-muted-foreground">{customer.email}</div>}
          </button>
          {canManage && change.allowed && panel === 'none' && (
            <button type="button" onClick={() => openPanel('search')} className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Сменить клиента
            </button>
          )}
          {!change.allowed && <p className="mt-1 text-xs text-muted-foreground">{change.reason}</p>}
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Клиент не определён</p>
          {canManage && panel === 'none' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openPanel('search')}>
                <Search className="mr-1 h-4 w-4" />
                Найти клиента
              </Button>
              {canCreate && (
                <Button size="sm" onClick={() => openPanel('create-customer')}>
                  <UserPlus className="mr-1 h-4 w-4" />
                  Создать клиента
                </Button>
              )}
            </div>
          )}
          {canManage && !canCreate && panel === 'none' && (
            <p className="text-xs text-muted-foreground">Создавать клиентов могут владелец и администратор.</p>
          )}
        </div>
      )}

      {/* ---- Find existing customer ---- */}
      {panel === 'search' && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
          <Label htmlFor="intake-search">Поиск клиента</Label>
          <Input
            id="intake-search"
            autoFocus
            placeholder="Имя, телефон или email"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setConfirmCustomer(null)
            }}
          />
          {searching && <p className="text-xs text-muted-foreground">Ищем…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground">Никого не нашли.</p>}
          {results.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border" aria-label="Найденные клиенты">
              {results.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{personName(c)}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.phone}</div>
                  </div>
                  {c.id === detail.customerId ? (
                    <span className="shrink-0 text-xs text-muted-foreground">уже связан</span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => chooseCustomer(c)}>
                      Связать
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {confirmCustomer && (
            <div className="space-y-2 rounded-md border border-amber-500/40 p-2" role="alert">
              <p>
                Сменить клиента диалога на <span className="font-medium">{confirmCustomer.name}</span>?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void link(confirmCustomer.id)}>
                  Да, сменить
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmCustomer(null)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {!customer && canCreate && (
              <Button size="sm" variant="ghost" onClick={() => openPanel('create-customer')}>
                Создать нового
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => openPanel('none')}>
              Закрыть
            </Button>
          </div>
        </div>
      )}

      {/* ---- Create customer ---- */}
      {panel === 'create-customer' && (
        <form onSubmit={handleCreateCustomer} className="space-y-2 rounded-md border border-border p-3 text-sm" aria-label="Новый клиент">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="intake-first-name">Имя</Label>
              <Input id="intake-first-name" required value={customerForm.firstName} onChange={(e) => setCustomerForm({ ...customerForm, firstName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intake-last-name">Фамилия</Label>
              <Input id="intake-last-name" value={customerForm.lastName} onChange={(e) => setCustomerForm({ ...customerForm, lastName: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="intake-phone">Телефон</Label>
            <Input id="intake-phone" required type="tel" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="intake-email">Email</Label>
            <Input id="intake-email" type="email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} />
          </div>
          {phoneMatches.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-500/40 p-2" aria-label="Клиенты с этим номером">
              {phoneMatches.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{personName(m)}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.phone}</div>
                  </div>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void link(m.id)}>
                    Связать существующего клиента
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохранение…' : 'Создать и связать'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openPanel('none')}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {/* ---- Vehicles of the linked customer ---- */}
      {customer && (
        <div className="space-y-1 pt-1 text-sm">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Автомобили клиента</h4>
          {vehiclesError && <p className="text-xs text-destructive">Не удалось загрузить автомобили.</p>}
          {vehiclesLoading && vehicles.length === 0 && <p className="text-muted-foreground">Загрузка…</p>}
          {!vehiclesLoading && !vehiclesError && vehicles.length === 0 && <p className="text-muted-foreground">Автомобилей пока нет</p>}
          {vehicles.length > 0 && (
            <ul className="space-y-1">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => navigate(`/vehicles?open=${v.id}`)} className="w-full rounded-md text-left hover:underline">
                    <span className="font-medium">{vehicleTitle(v)}</span>
                    {v.licensePlate && <span className="text-muted-foreground"> · {v.licensePlate}</span>}
                    {v.id === requestVehicleId && <span className="ml-1 text-xs text-primary">в обращении</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!detail.customerRequestId && vehicles.length > 0 && (
            <p className="text-xs text-muted-foreground">Автомобиль для работы выбирается при создании обращения.</p>
          )}
          {canCreate && panel === 'none' && (
            <Button size="sm" variant="outline" onClick={() => openPanel('add-vehicle')}>
              <Plus className="mr-1 h-4 w-4" />
              Добавить автомобиль
            </Button>
          )}
        </div>
      )}

      {/* ---- Add vehicle ---- */}
      {panel === 'add-vehicle' && customer && (
        <form onSubmit={handleAddVehicle} className="space-y-2 rounded-md border border-border p-3 text-sm" aria-label="Новый автомобиль">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="intake-make">Марка</Label>
              <Input id="intake-make" required value={vehicleForm.make} onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intake-model">Модель</Label>
              <Input id="intake-model" required value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intake-year">Год</Label>
              <Input id="intake-year" inputMode="numeric" value={vehicleForm.year} onChange={(e) => setVehicleForm({ ...vehicleForm, year: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="intake-plate">Госномер</Label>
              <Input id="intake-plate" value={vehicleForm.licensePlate} onChange={(e) => setVehicleForm({ ...vehicleForm, licensePlate: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="intake-vin">VIN</Label>
            <Input id="intake-vin" value={vehicleForm.vin} onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Сохранение…' : 'Добавить'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => openPanel('none')}>
              Отмена
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
