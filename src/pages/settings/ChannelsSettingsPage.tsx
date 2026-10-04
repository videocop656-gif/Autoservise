import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { PageHeader } from '../../components/layout/PageHeader'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'
import { recoverySetupView, smsTransportView, telephonyView, whatsappTransportView, type SmsTransportStatusLike, type TelephonyStatusLike, type WhatsAppTransportStatusLike } from '../../components/channels/recoverySetup'

type ChannelType = 'TELEGRAM' | 'WHATSAPP' | 'WEBSITE' | 'SMS'
type ChannelStatus = 'ACTIVE' | 'INACTIVE'

interface ChannelConnectionDto {
  id: string
  type: ChannelType
  status: ChannelStatus
  displayName: string
  externalAccountId: string
  config: Record<string, unknown> | null
  // MCR-7B1 — real transport and masked sender (never credentials).
  provider?: string | null
  senderMasked?: string | null
  routingActive?: boolean
  createdAt: string
  updatedAt: string
}

/** Safe, non-secret display value only — see channelConnectionService.ts's sanitizeChannelConfig() (never the bot token/webhook secret, which never leave the server at all). */
function telegramUsername(connection: ChannelConnectionDto): string | null {
  const value = connection.config?.telegramUsername
  return typeof value === 'string' ? value : null
}

const TYPE_LABEL: Record<ChannelType, string> = { TELEGRAM: 'Telegram', WHATSAPP: 'WhatsApp', WEBSITE: 'Website Chat', SMS: 'SMS' }
const CHANNEL_TYPES: ChannelType[] = ['TELEGRAM', 'WHATSAPP', 'WEBSITE', 'SMS']

interface CreateFormState {
  type: ChannelType
  displayName: string
  externalAccountId: string
}

const EMPTY_CREATE_FORM: CreateFormState = { type: 'TELEGRAM', displayName: '', externalAccountId: '' }

export default function ChannelsSettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'owner' || user?.role === 'admin'

  const [connections, setConnections] = useState<ChannelConnectionDto[]>([])
  // MCR-7A — server-wide SMS transport (provider, mode, sender); secrets never reach the client.
  const [smsTransport, setSmsTransport] = useState<SmsTransportStatusLike | null>(null)
  const [whatsappTransport, setWhatsappTransport] = useState<WhatsAppTransportStatusLike | null>(null)
  // MCR-8A — telephony (Kcell Virtual PBX) for this business; no secrets.
  const [telephony, setTelephony] = useState<TelephonyStatusLike | null>(null)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({})
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  // MCR-6 — customerEntryPhone: the WhatsApp number customers open from the recovery SMS (WhatsApp only).
  const [editForm, setEditForm] = useState({ displayName: '', externalAccountId: '', customerEntryPhone: '' })
  const editingConnection = connections.find((c) => c.id === editingId) ?? null
  const [editError, setEditError] = useState<string | null>(null)
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  // Real Telegram Channel Integration (Prompt 18) — a separate action from
  // the generic Activate button: a TELEGRAM connection can only become
  // ACTIVE via this setup call (getMe + setWebhook), never by flipping a
  // status flag alone. See telegramSetupService.ts.
  const [settingUpId, setSettingUpId] = useState<string | null>(null)

  async function loadConnections() {
    setLoading(true)
    setListError(null)
    try {
      const data = await apiFetch<{ connections: ChannelConnectionDto[] }>('/api/channels')
      setConnections(data.connections)
    } catch {
      setListError('Не удалось загрузить каналы.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConnections()
    apiFetch<{ sms: SmsTransportStatusLike }>('/api/channels/sms-transport')
      .then((data) => setSmsTransport(data.sms))
      .catch(() => setSmsTransport(null))
    apiFetch<{ whatsapp: WhatsAppTransportStatusLike }>('/api/channels/whatsapp-transport')
      .then((data) => setWhatsappTransport(data.whatsapp))
      .catch(() => setWhatsappTransport(null))
    apiFetch<{ telephony: TelephonyStatusLike }>('/api/telephony/kcell')
      .then((data) => setTelephony(data.telephony))
      .catch(() => setTelephony(null))
  }, [])

  function openCreateForm() {
    setCreateForm(EMPTY_CREATE_FORM)
    setCreateError(null)
    setCreateFieldErrors({})
    setShowCreateForm(true)
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateFieldErrors({})
    setCreating(true)
    try {
      await apiFetch('/api/channels', { method: 'POST', body: JSON.stringify(createForm) })
      setShowCreateForm(false)
      await loadConnections()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message || 'Проверьте заполненные поля.')
        setCreateFieldErrors(err.fieldErrors)
      } else {
        setCreateError('Не удалось создать канал.')
      }
    } finally {
      setCreating(false)
    }
  }

  function openEditForm(connection: ChannelConnectionDto) {
    setEditingId(connection.id)
    const entry = connection.config?.customerEntryPhone
    setEditForm({ displayName: connection.displayName, externalAccountId: connection.externalAccountId, customerEntryPhone: typeof entry === 'string' ? entry : '' })
    setEditError(null)
    setEditFieldErrors({})
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editingId) return
    setEditError(null)
    setEditFieldErrors({})
    setSaving(true)
    try {
      const { customerEntryPhone, ...profile } = editForm
      // Config is replaced as a whole on PATCH: keep the existing keys, change only the entry number.
      const body =
        editingConnection?.type === 'WHATSAPP'
          ? { ...profile, config: { ...(editingConnection.config ?? {}), customerEntryPhone: customerEntryPhone.trim() || null } }
          : profile
      await apiFetch(`/api/channels/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
      setEditingId(null)
      await loadConnections()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setEditError(err.message || 'Проверьте заполненные поля.')
        setEditFieldErrors(err.fieldErrors)
      } else {
        setEditError('Не удалось сохранить изменения.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleActivate(connection: ChannelConnectionDto) {
    setActionError(null)
    try {
      await apiFetch(`/api/channels/${connection.id}/activate`, { method: 'POST' })
      await loadConnections()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось активировать канал.')
    }
  }

  async function handleDeactivate(connection: ChannelConnectionDto) {
    setActionError(null)
    try {
      await apiFetch(`/api/channels/${connection.id}/deactivate`, { method: 'POST' })
      await loadConnections()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось деактивировать канал.')
    }
  }

  // MCR-8A — activate / disable the Kcell PBX integration prepared on the server.
  async function handleKcell(connect: boolean) {
    setActionError(null)
    try {
      const data = await apiFetch<{ telephony: TelephonyStatusLike }>('/api/telephony/kcell', { method: connect ? 'POST' : 'DELETE' })
      setTelephony(data.telephony)
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось изменить подключение телефонии.')
    }
  }

  // MCR-7B1 — attach / detach the Twilio sender assigned to this business by the server.
  async function handleTwilio(connection: ChannelConnectionDto, connect: boolean) {
    setActionError(null)
    try {
      await apiFetch(`/api/channels/${connection.id}/twilio/connect`, { method: connect ? 'POST' : 'DELETE' })
      await loadConnections()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось изменить подключение Twilio.')
    }
  }

  async function handleTelegramSetup(connection: ChannelConnectionDto) {
    setActionError(null)
    setSettingUpId(connection.id)
    try {
      await apiFetch(`/api/channels/${connection.id}/telegram/setup`, { method: 'POST' })
      await loadConnections()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось подключить Telegram-бота.')
    } finally {
      setSettingUpId(null)
    }
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <PageHeader title="Каналы" subtitle="Connected communication channels" />
        {/* MCR-6 — missed-call recovery setup at a glance. */}
        {!loading && !listError && (() => {
          const view = recoverySetupView(connections)
          return (
            <Card>
              <CardHeader>
                <CardTitle>Восстановление пропущенных звонков</CardTitle>
                <CardDescription>{view.fallback}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div>
                  WhatsApp: <span className={view.whatsapp.configured ? 'text-success' : 'text-muted-foreground'}>{view.whatsapp.label}</span>
                </div>
                <div>
                  SMS для восстановления: <span className={view.sms.configured ? 'text-success' : 'text-muted-foreground'}>{view.sms.label}</span>
                </div>
                {whatsappTransport && (() => {
                  const wa = whatsappTransportView(whatsappTransport)
                  return (
                    <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                      <div>
                        WhatsApp-провайдер: <span className="text-foreground">{wa.provider}</span> · режим: {wa.mode} ·{' '}
                        <span className={wa.ok ? 'text-success' : 'text-muted-foreground'}>{wa.status}</span>
                      </div>
                      <div className="break-words">Номер WhatsApp: {wa.sender}</div>
                      <div>{wa.template}</div>
                    </div>
                  )
                })()}
                {telephony && (() => {
                  const tel = telephonyView(telephony)
                  return (
                    <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                      <div>
                        Телефония: <span className="text-foreground">{tel.provider}</span> ·{' '}
                        <span className={tel.ok ? 'text-success' : 'text-muted-foreground'}>{tel.status}</span>
                      </div>
                      <div className="break-words">Номер: {tel.numbers}</div>
                      <div>{tel.events}</div>
                      {canManage && (tel.canConnect || tel.canDisconnect) && (
                        <div className="pt-1">
                          <Button variant="outline" size="sm" onClick={() => void handleKcell(tel.canConnect)}>
                            {tel.canConnect ? 'Подключить Kcell' : 'Отключить Kcell'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })()}
                {smsTransport && (() => {
                  const sms = smsTransportView(smsTransport)
                  return (
                    <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                      <div>
                        SMS-провайдер: <span className="text-foreground">{sms.provider}</span> · режим: {sms.mode} ·{' '}
                        <span className={sms.ok ? 'text-success' : 'text-destructive'}>{sms.status}</span>
                      </div>
                      <div className="break-words">Отправитель: {sms.sender}</div>
                      {sms.webhook && <div>{sms.webhook}</div>}
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          )
        })()}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Channels</CardTitle>
              <CardDescription>
                Внешние каналы связи (Telegram, WhatsApp, Website Chat, SMS). Telegram может быть подключён к реальному
                Telegram Bot API — остальные каналы пока foundation-уровня (внутренний тестовый pipeline). Автоответы
                AI включаются отдельно в разделе AI и работают только в WhatsApp.
              </CardDescription>
            </div>
            {canManage && (
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add channel
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            {!loading && connections.length === 0 && <p className="text-sm text-muted-foreground">Каналов пока нет.</p>}

            {connections.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Channel</th>
                      <th className="py-2 pr-3 font-medium">Display name</th>
                      <th className="py-2 pr-3 font-medium">External account</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                      <th className="py-2 pr-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map((connection) => {
                      const isTelegram = connection.type === 'TELEGRAM'
                      const username = telegramUsername(connection)
                      return (
                        <tr key={connection.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{TYPE_LABEL[connection.type]}</td>
                          <td className="py-2 pr-3">
                            {connection.displayName}
                            {isTelegram && username && <div className="text-xs text-muted-foreground">Bot: @{username}</div>}
                            {connection.type === 'WHATSAPP' && (
                              <div className="text-xs text-muted-foreground">
                                {connection.provider === 'twilio'
                                  ? `Twilio · ${connection.senderMasked ?? 'номер не задан'}${connection.routingActive ? ' · сообщения клиентов принимаются' : ''}`
                                  : 'Тестовый (mock)'}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{connection.externalAccountId}</td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                connection.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {connection.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                            </span>
                            {isTelegram && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                Webhook: {connection.status === 'ACTIVE' ? 'configured' : 'not configured'}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{new Date(connection.createdAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-3">
                            {canManage ? (
                              <div className="flex flex-wrap gap-1.5">
                                <Button variant="ghost" size="sm" onClick={() => openEditForm(connection)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                {connection.type === 'WHATSAPP' && (
                                  <Button variant="outline" size="sm" onClick={() => void handleTwilio(connection, connection.provider !== 'twilio')}>
                                    {connection.provider === 'twilio' ? 'Отключить Twilio' : 'Подключить Twilio'}
                                  </Button>
                                )}
                                {connection.status === 'ACTIVE' ? (
                                  <Button variant="outline" size="sm" onClick={() => handleDeactivate(connection)}>
                                    Deactivate
                                  </Button>
                                ) : isTelegram ? (
                                  <Button variant="outline" size="sm" disabled={settingUpId === connection.id} onClick={() => handleTelegramSetup(connection)}>
                                    {settingUpId === connection.id ? 'Connecting...' : 'Connect'}
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" onClick={() => handleActivate(connection)}>
                                    Activate
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">View only</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {showCreateForm && canManage && (
          <Card>
            <CardHeader>
              <CardTitle>New channel</CardTitle>
              <CardDescription>No API token, secret, or OAuth credential is ever collected here.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="channel-type">Channel type</Label>
                  <select
                    id="channel-type"
                    value={createForm.type}
                    onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as ChannelType })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {CHANNEL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-display-name">Display name</Label>
                  <Input
                    id="channel-display-name"
                    required
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })}
                  />
                  {createFieldErrors.displayName && <p className="text-sm text-destructive">{createFieldErrors.displayName[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="channel-external-id">External account ID</Label>
                  <Input
                    id="channel-external-id"
                    required
                    placeholder="e.g. bot username, phone-number id, widget id"
                    value={createForm.externalAccountId}
                    onChange={(e) => setCreateForm({ ...createForm, externalAccountId: e.target.value })}
                  />
                  {createFieldErrors.externalAccountId && (
                    <p className="text-sm text-destructive">{createFieldErrors.externalAccountId[0]}</p>
                  )}
                </div>

                {createError && <p className="text-sm text-destructive">{createError}</p>}

                <div className="flex gap-2">
                  <Button type="submit" disabled={creating}>
                    {creating ? 'Creating...' : 'Create'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {editingId && (
          <Card>
            <CardHeader>
              <CardTitle>Edit channel</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-display-name">Display name</Label>
                  <Input
                    id="edit-display-name"
                    required
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  />
                  {editFieldErrors.displayName && <p className="text-sm text-destructive">{editFieldErrors.displayName[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-external-id">External account ID</Label>
                  <Input
                    id="edit-external-id"
                    required
                    value={editForm.externalAccountId}
                    onChange={(e) => setEditForm({ ...editForm, externalAccountId: e.target.value })}
                  />
                  {editFieldErrors.externalAccountId && (
                    <p className="text-sm text-destructive">{editFieldErrors.externalAccountId[0]}</p>
                  )}
                </div>
                {editingConnection?.type === 'WHATSAPP' && (
                  <div className="space-y-2">
                    <Label htmlFor="edit-entry-phone">Номер WhatsApp для клиентов</Label>
                    <Input
                      id="edit-entry-phone"
                      inputMode="tel"
                      placeholder="+7 701 123 45 67"
                      value={editForm.customerEntryPhone}
                      onChange={(e) => setEditForm({ ...editForm, customerEntryPhone: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      На этот номер клиент попадает по ссылке из SMS после пропущенного звонка.
                    </p>
                  </div>
                )}

                {editError && <p className="text-sm text-destructive">{editError}</p>}

                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
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
