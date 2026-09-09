import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/utils'
import type { NavItem } from './navigation'

/**
 * Shared list rendering for both the desktop Sidebar and the mobile drawer
 * (spec §16: reusable, not duplicated). Active state (spec §11): a small
 * gold indicator bar, a gold icon, and a subtle gold-tinted background —
 * deliberately never a full-width solid-gold button (spec §6/§19).
 */
export default function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
                'hover:bg-muted hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'bg-primary/10 text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <item.icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}
