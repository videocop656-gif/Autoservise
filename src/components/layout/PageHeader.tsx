import type { ReactNode } from 'react'

/**
 * Title + subtitle used at the top of a page's content (spec §16). Used by
 * the primary nav destinations (spec §15's exact copy) and the Settings
 * hub; the existing settings sub-pages keep their own Card-based header
 * unchanged (out of scope for this foundation pass — see Final Report).
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
