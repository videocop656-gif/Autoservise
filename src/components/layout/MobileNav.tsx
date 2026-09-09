import { useEffect } from 'react'
import { X, Wrench } from 'lucide-react'
import SidebarNav from './SidebarNav'
import UserMenu from './UserMenu'
import { NAV_ITEMS, BOTTOM_NAV_ITEMS } from './navigation'
import { cn } from '../../lib/utils'

/**
 * Mobile drawer navigation (spec §9/§22) — the sidebar's mobile
 * counterpart, reusing the exact same SidebarNav/UserMenu components
 * rather than duplicating markup. Closes on: backdrop click, the close
 * button, Escape, or navigating to a link.
 */
export default function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card transition-transform duration-200 lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Навигация"
        aria-hidden={open ? undefined : true}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <span className="flex items-center gap-2 truncate text-base font-semibold text-foreground">
            <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
            AI Администратор
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Основная навигация">
          <SidebarNav items={NAV_ITEMS} onNavigate={onClose} />
        </nav>

        <div className="border-t border-border px-3 py-2">
          <SidebarNav items={BOTTOM_NAV_ITEMS} onNavigate={onClose} />
        </div>

        <div className="border-t border-border p-3">
          <UserMenu />
        </div>
      </div>
    </>
  )
}
