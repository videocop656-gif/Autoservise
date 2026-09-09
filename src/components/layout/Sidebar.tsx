import { Wrench } from 'lucide-react'
import SidebarNav from './SidebarNav'
import UserMenu from './UserMenu'
import { NAV_ITEMS, BOTTOM_NAV_ITEMS } from './navigation'

/**
 * Fixed-width desktop sidebar (spec §9/§10) — visually calm: dark
 * background, a subtle right border, white/gray text; gold appears only in
 * SidebarNav's active-state indicator (spec §11), never as the sidebar's
 * own background. Hidden below the `lg` breakpoint — MobileNav takes over
 * there (spec §22).
 */
export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5">
        <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
        <span className="truncate text-base font-semibold text-foreground">AI Администратор</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Основная навигация">
        <SidebarNav items={NAV_ITEMS} />
      </nav>

      <div className="border-t border-border px-3 py-2">
        <SidebarNav items={BOTTOM_NAV_ITEMS} />
      </div>

      <div className="border-t border-border p-3">
        <UserMenu />
      </div>
    </aside>
  )
}
