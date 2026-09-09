import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import MobileNav from './MobileNav'

/**
 * The application shell (Prompt 19 spec §9) — Sidebar + Header + an
 * independently-scrollable main content area. Mounted once, as a layout
 * route in App.tsx, wrapping every authenticated page (spec: this is the
 * foundation of the whole product, not just the new placeholder sections —
 * see the Final Report's "Frontend architecture" section for why).
 */
export default function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
    </div>
  )
}
