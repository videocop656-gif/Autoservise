import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { PageContainer } from '../../components/layout/PageContainer'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { apiFetch, ApiClientError } from '../../lib/apiClient'
import { useAuth } from '../../context/AuthContext'

type Role = 'owner' | 'admin' | 'manager'

interface TeamUserDto {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  createdAt: string
  updatedAt: string
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager' }

/** Roles the CURRENT user is allowed to assign — server-enforced regardless (spec §21: "Frontend не должен самостоятельно считать backend authorization источником истины"), this only decides what's offered. */
function assignableRoles(currentRole: Role): Role[] {
  if (currentRole === 'owner') return ['owner', 'admin', 'manager']
  if (currentRole === 'admin') return ['admin', 'manager']
  return []
}

/** Mirrors the server's permission matrix (spec §2/§12) purely for UI hiding — every mutation is re-checked server-side regardless. */
function canManageTarget(currentRole: Role, targetRole: Role): boolean {
  if (currentRole === 'owner') return true
  if (currentRole === 'admin') return targetRole !== 'owner'
  return false
}

/** Profile-edit visibility only — unlike role/status changes, self-editing IS allowed for owner/admin (spec §4's "Profile update собственного пользователя"), just never for manager (spec §12: unconditional). */
function canEditProfile(currentRole: Role, targetRole: Role): boolean {
  if (currentRole === 'manager') return false
  if (currentRole === 'admin') return targetRole !== 'owner'
  return true
}

interface CreateFormState {
  name: string
  email: string
  password: string
  role: Role
}

function emptyCreateForm(role: Role): CreateFormState {
  return { name: '', email: '', password: '', role }
}

export default function TeamSettingsPage() {
  const { user } = useAuth()
  const currentRole = (user?.role ?? 'manager') as Role
  const currentUserId = user?.id
  const canCreate = currentRole === 'owner' || currentRole === 'admin'

  const [members, setMembers] = useState<TeamUserDto[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm('manager'))
  const [createError, setCreateError] = useState<string | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string[]>>({})
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const [pendingDeactivateId, setPendingDeactivateId] = useState<string | null>(null)

  async function loadMembers() {
    setLoading(true)
    setListError(null)
    try {
      const data = await apiFetch<{ members: TeamUserDto[] }>('/api/team')
      setMembers(data.members)
    } catch {
      setListError('Не удалось загрузить список сотрудников.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
  }, [])

  function openCreateForm() {
    const options = assignableRoles(currentRole)
    setCreateForm(emptyCreateForm(options[options.length - 1] ?? 'manager'))
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
      await apiFetch('/api/team', { method: 'POST', body: JSON.stringify(createForm) })
      setShowCreateForm(false)
      await loadMembers()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setCreateError(err.message || 'Проверьте заполненные поля.')
        setCreateFieldErrors(err.fieldErrors)
      } else {
        setCreateError('Не удалось создать сотрудника.')
      }
    } finally {
      setCreating(false)
    }
  }

  function openEditForm(member: TeamUserDto) {
    setEditingId(member.id)
    setEditForm({ name: member.name, email: member.email })
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
      await apiFetch(`/api/team/${editingId}`, { method: 'PATCH', body: JSON.stringify(editForm) })
      setEditingId(null)
      await loadMembers()
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

  async function handleRoleChange(member: TeamUserDto, role: Role) {
    if (role === member.role) return
    setActionError(null)
    try {
      await apiFetch(`/api/team/${member.id}/role`, { method: 'POST', body: JSON.stringify({ role }) })
      await loadMembers()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось изменить роль.')
    }
  }

  async function handleActivate(member: TeamUserDto) {
    setActionError(null)
    try {
      await apiFetch(`/api/team/${member.id}/activate`, { method: 'POST' })
      await loadMembers()
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось активировать сотрудника.')
    }
  }

  async function handleDeactivate(member: TeamUserDto) {
    setActionError(null)
    try {
      await apiFetch(`/api/team/${member.id}/deactivate`, { method: 'POST' })
      setPendingDeactivateId(null)
      await loadMembers()
    } catch (err) {
      setPendingDeactivateId(null)
      setActionError(err instanceof ApiClientError ? err.message : 'Не удалось деактивировать сотрудника.')
    }
  }

  return (
    <PageContainer className="max-w-4xl space-y-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Сотрудники этого бизнеса. Несколько owner допускаются — каждый может редактировать профиль другого,
                но роль и статус меняются только через отдельные действия.
              </CardDescription>
            </div>
            {canCreate && (
              <Button size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add team member
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
            {listError && <p className="text-sm text-destructive">{listError}</p>}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
            {!loading && members.length === 0 && <p className="text-sm text-muted-foreground">Сотрудников пока нет.</p>}

            {members.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Role</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                      <th className="py-2 pr-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => {
                      const isSelf = member.id === currentUserId
                      const manageable = canManageTarget(currentRole, member.role) && !isSelf
                      const roleOptions = assignableRoles(currentRole)
                      return (
                        <tr key={member.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            {member.name} {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{member.email}</td>
                          <td className="py-2 pr-3">
                            {manageable && roleOptions.length > 0 ? (
                              <select
                                value={member.role}
                                onChange={(e) => handleRoleChange(member, e.target.value as Role)}
                                className="h-8 rounded-md border border-input bg-background px-1.5 text-sm"
                              >
                                {roleOptions.map((r) => (
                                  <option key={r} value={r}>
                                    {ROLE_LABEL[r]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              ROLE_LABEL[member.role]
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                member.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {member.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{new Date(member.createdAt).toLocaleDateString()}</td>
                          <td className="py-2 pr-3">
                            <div className="flex flex-wrap gap-1.5">
                              {canEditProfile(currentRole, member.role) && (
                                <Button variant="ghost" size="sm" onClick={() => openEditForm(member)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {manageable &&
                                (member.isActive ? (
                                  <Button variant="outline" size="sm" onClick={() => setPendingDeactivateId(member.id)}>
                                    Deactivate
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" onClick={() => handleActivate(member)}>
                                    Activate
                                  </Button>
                                ))}
                            </div>
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

        {pendingDeactivateId && (
          <Card>
            <CardHeader>
              <CardTitle>Deactivate this team member?</CardTitle>
              <CardDescription>They will no longer be able to sign in. This can be undone later.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const member = members.find((m) => m.id === pendingDeactivateId)
                  if (member) void handleDeactivate(member)
                }}
              >
                Deactivate
              </Button>
              <Button variant="ghost" onClick={() => setPendingDeactivateId(null)}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        )}

        {showCreateForm && canCreate && (
          <Card>
            <CardHeader>
              <CardTitle>New team member</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="team-name">Name</Label>
                  <Input id="team-name" required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
                  {createFieldErrors.name && <p className="text-sm text-destructive">{createFieldErrors.name[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-email">Email</Label>
                  <Input id="team-email" type="email" required value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                  {createFieldErrors.email && <p className="text-sm text-destructive">{createFieldErrors.email[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-password">Password</Label>
                  <Input
                    id="team-password"
                    type="password"
                    required
                    minLength={8}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  />
                  {createFieldErrors.password && <p className="text-sm text-destructive">{createFieldErrors.password[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-role">Role</Label>
                  <select
                    id="team-role"
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as Role })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {assignableRoles(currentRole).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
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
              <CardTitle>Edit profile</CardTitle>
              <CardDescription>Name and email only — role and status are changed separately.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  {editFieldErrors.name && <p className="text-sm text-destructive">{editFieldErrors.name[0]}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input id="edit-email" type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  {editFieldErrors.email && <p className="text-sm text-destructive">{editFieldErrors.email[0]}</p>}
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
    </PageContainer>
  )
}
