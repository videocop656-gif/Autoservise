import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Button } from '../ui/button'
import { getPageTitle } from './navigation'

/**
 * App-wide header (spec §12) — visually separated from content by a subtle
 * bottom border, shows the current page title. Deliberately minimal: no
 * fake notifications badge, no breadcrumbs (this app has no nested-detail
 * routes yet), no duplicate user menu (already in the sidebar/mobile
 * drawer, spec §13) — "не перегружать header".
 */
export default function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const location = useLocation()
  const title = getPageTitle(location.pathname)

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
      <Button variant="ghost" size="sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label="Открыть меню">
        <Menu className="h-5 w-5" />
      </Button>
      <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
    </header>
  )
}
