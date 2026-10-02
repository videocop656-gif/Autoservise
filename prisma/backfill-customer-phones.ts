// MCR-1 — explicit, idempotent backfill of Customer.phoneE164.
//
//   npm run backfill:customer-phones            # apply
//   npm run backfill:customer-phones -- --dry-run
//
// Run after `prisma migrate deploy` (20261002120000_customer_phone_e164 adds
// the column without SQL normalization). Business by business, it recomputes
// every customer's canonical phone with the application's own normalizePhone
// in that business's phoneRegion and writes only rows that actually change —
// re-running is safe and a no-op once current. Every write is scoped by
// tenantId + businessId + id. Customer.phone is never modified.
// Output is counts only: no phone number is ever printed.
import { PrismaClient } from '@prisma/client'
import { planPhoneBackfill, phoneCollisionCounts } from '../src/server/lib/phoneBackfill'

const prisma = new PrismaClient()
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const businesses = await prisma.business.findMany({ select: { id: true, tenantId: true, phoneRegion: true } })
  const totals = { businesses: businesses.length, total: 0, valid: 0, invalid: 0, empty: 0, changed: 0, unchanged: 0, written: 0 }

  for (const business of businesses) {
    const rows = await prisma.customer.findMany({
      where: { tenantId: business.tenantId, businessId: business.id },
      select: { id: true, phone: true, phoneE164: true },
    })
    const plan = planPhoneBackfill(rows, business.phoneRegion)
    for (const key of ['total', 'valid', 'invalid', 'empty', 'changed', 'unchanged'] as const) totals[key] += plan.counts[key]
    if (dryRun) continue
    for (const update of plan.updates) {
      const result = await prisma.customer.updateMany({
        where: { id: update.id, tenantId: business.tenantId, businessId: business.id },
        data: { phoneE164: update.phoneE164 },
      })
      totals.written += result.count
    }
  }

  const after = await prisma.customer.findMany({ select: { tenantId: true, businessId: true, isActive: true, phoneE164: true } })
  console.log(JSON.stringify({ dryRun, ...totals, collisions: phoneCollisionCounts(after) }, null, 2))
}

main()
  .catch((err) => {
    console.error('backfill failed:', err instanceof Error ? err.message : 'unknown error')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
