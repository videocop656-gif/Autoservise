import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil } from 'lucide-react'
import Nav from '../../components/Nav'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type ChannelType = 'TELEGRAM' | 'WHATSAPP' | 'WEBSITE'
type ChannelStatus = 'ACTIVE' | 'INACTIVE'

interface ChannelConnectionDto {
  id: string
  type: ChannelType
  status: ChannelStatus
  displayName: string
  externalAccountId: string
  config: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/** Safe, non-secret display value only — see channelConnectionService.ts's sanitizeChannelConfig() (never the bot token/webhook secret, which never leave the server at all). */
function telegramUsername(connection: ChannelConnectionDto): string | null {
  const value = connection.config?.telegramUsername
  return typeof value === 'string' ? value : null
}

const TYPE_LABEL: Record<ChannelType, string> = { TELEGRAM: 'Telegram', WHATSAPP: 'WhatsApp', WEBSITE: 'Website Chat' }
const CHANNEL_TYPES: ChannelType[] = ['TELEGRAM', 'WHATSAPP', 'WEBSITE']

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
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({})
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ displayName: '', externalAccountId: '' })
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
    setEditForm({ displayName: connection.displayName, externalAccountId: connection.externalAccountId })
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
      await apiFetch(`/api/channels/${editingId}`, { method: 'PATCH', body: JSON.stringify(editForm) })
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
    <div className="min-h-screen bg-muted/30">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Channels</CardTitle>
              <CardDescription>
                Внешние каналы связи (Telegram, WhatsApp, Website Chat). Telegram может быть подключён к реальному
                Telegram Bot API — остальные каналы пока foundation-уровня (внутренний тестовый pipeline). AI не
                отвечает автоматически ни в одном канале.
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
      </div>
    </div>
  )
}
