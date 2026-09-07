import { NavLink, useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { Button } from './ui/button'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/utils'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/settings/business', label: 'Business Settings' },
  { to: '/settings/hours', label: 'Hours' },
  { to: '/settings/services', label: 'Services' },
  { to: '/settings/knowledge', label: 'Knowledge Base' },
  { to: '/settings/rules', label: 'Rules' },
  { to: '/settings/customers', label: 'Customers' },
  { to: '/settings/vehicles', label: 'Vehicles' },
  { to: '/settings/leads', label: 'Leads' },
]

/** Shown on every authenticated page. Only lists routes — role-based action buttons live inside each page. */
export default function Nav() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <nav className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 font-semibold">
            <Wrench className="h-4 w-4" />
            Автосервис
          </span>
          <div className="flex flex-wrap gap-1">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground font-medium'
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Выйти
        </Button>
      </div>
    </nav>
  )
}
