import { parsePhone } from './phone'

// ---------------------------------------------------------------------------
// MCR-1 — the pure half of the Customer.phoneE164 backfill (the runner is
// prisma/backfill-customer-phones.ts). Recomputes every customer's canonical
// phone with the SAME normalizePhone the services use, in the business's
// default region, and plans only real changes — so it is idempotent: a
// second run plans nothing. Invalid/empty legacy phones get NULL, never a
// guess; Customer.phone itself is never touched.
// ---------------------------------------------------------------------------

export interface BackfillCustomerRow {
  id: string
  phone: string
  phoneE164: string | null
}

export interface PhoneBackfillPlan {
  updates: { id: string; phoneE164: string | null }[]
  counts: { total: number; valid: number; invalid: number; empty: number; changed: number; unchanged: number }
}

export function planPhoneBackfill(rows: readonly BackfillCustomerRow[], defaultRegion: string | null | undefined): PhoneBackfillPlan {
  const counts = { total: rows.length, valid: 0, invalid: 0, empty: 0, changed: 0, unchanged: 0 }
  const updates: PhoneBackfillPlan['updates'] = []
  for (const row of rows) {
    const result = parsePhone(row.phone, defaultRegion)
    counts[result.status]++
    const next = result.status === 'valid' ? result.e164 : null
    if (next === row.phoneE164) {
      counts.unchanged++
    } else {
      counts.changed++
      updates.push({ id: row.id, phoneE164: next })
    }
  }
  return { updates, counts }
}

/** Collision audit over canonical phones (counts only — never the numbers). */
export function phoneCollisionCounts(rows: readonly { businessId: string; tenantId: string; isActive: boolean; phoneE164: string | null }[]) {
  const perBusiness = new Map<string, number>()
  const businessesPerNumber = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.phoneE164) continue
    if (r.isActive) {
      const key = `${r.businessId}|${r.phoneE164}`
      perBusiness.set(key, (perBusiness.get(key) ?? 0) + 1)
    }
    const set = businessesPerNumber.get(r.phoneE164) ?? new Set<string>()
    set.add(`${r.tenantId}|${r.businessId}`)
    businessesPerNumber.set(r.phoneE164, set)
  }
  const dupGroups = [...perBusiness.values()].filter((n) => n > 1)
  return {
    activeDuplicateGroupsWithinBusiness: dupGroups.length,
    largestActiveDuplicateGroup: dupGroups.length ? Math.max(...dupGroups) : 0,
    numbersSharedAcrossBusinesses: [...businessesPerNumber.values()].filter((s) => s.size > 1).length,
  }
}
