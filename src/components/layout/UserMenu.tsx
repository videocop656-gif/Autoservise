import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'

const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер' }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Bottom-of-sidebar account area (spec §13) — a reusable component, shared
 * by the desktop Sidebar and MobileNav. Shows the REAL authenticated
 * user/business (never invented placeholder personal information — spec
 * explicitly forbids fake personal data) with a real logout action.
 *
 * A static block rather than a popover/dropdown menu: no menu-primitive
 * library is installed in this project (only @radix-ui/react-label and
 * @radix-ui/react-slot), and adding one for a single "Log out" action isn't
 * necessary for this foundation stage — see Final Report.
 */
export default function UserMenu() {
  const { user, business, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  if (!user) return null

  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        aria-hidden="true"
      >
        {initials(user.name) || '?'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ROLE_LABEL[user.role] ?? user.role}
          {business ? ` · ${business.name}` : ''}
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Выйти из аккаунта" title="Выйти">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  )
}
