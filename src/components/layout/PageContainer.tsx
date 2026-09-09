import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/**
 * The one place every page's content padding/max-width comes from (spec
 * §16/§17) — replaces each page's own ad-hoc `<div className="min-h-screen
 * bg-muted/30"><Nav />...">` wrapper now that AppShell provides that chrome
 * once, globally. `className` carries each page's own max-width/spacing
 * choice forward unchanged (e.g. "max-w-4xl space-y-6") — a deliberate,
 * page-by-page preserved value, not a new default.
 */
export function PageContainer({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full p-6', className)}>{children}</div>
}
