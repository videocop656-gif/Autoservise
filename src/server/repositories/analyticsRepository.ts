import type { AiLogOperation } from '@prisma/client'
import { prisma } from '../db/prisma'
import { withTenant } from '../lib/tenantScope'

// Named, explicitly-typed constants rather than inline string literals —
// `withTenant`'s `T extends Record<string, unknown>` constraint otherwise
// widens an inline `operation: AI_ANALYZE` literal to plain `string`
// during inference (a TypeScript quirk with index-signature-constrained
// generics), which would silently break every one of Prisma's enum-typed
// `where` clauses below.
const AI_ANALYZE: AiLogOperation = 'AI_ANALYZE'
const AI_TOOL_EXECUTION: AiLogOperation = 'AI_TOOL_EXECUTION'

/** [start, end) — the same half-open convention as every existing dateFrom/dateTo filter in this codebase (spec §27). */
interface Range {
  start: Date
  end: Date
}

function createdAtInRange(range: Range) {
  return { createdAt: { gte: range.start, lt: range.end } }
}

/** One raw `COUNT(*)` day-bucket row. `day` comes back as a Postgres `date` (midnight-UTC `Date`, no time component). */
interface DayCountRow {
  day: Date
  count: number
}

/** Every day-bucket query returns this shape — converted to `{date: "YYYY-MM-DD", count}[]` (with empty days filled in) by analyticsService.ts. */
export type DayBucket = DayCountRow

// Every query below is scoped by BOTH tenantId and businessId (never tenantId
// alone — spec §37's "wrong business" isolation requirement) via
// `withTenant()`, the same helper every other repository in this codebase
// uses. Aggregation happens entirely in Postgres (`count`/`groupBy`/
// `aggregate`, or a small number of parameterized raw queries for
// timezone-aware day-bucketing that Prisma's query builder cannot express —
// spec §35) — never `findMany()` + a JS reduce over a large table.
export const analyticsRepository = {
  async customerRequestsByStatus(tenantId: string, businessId: string, range: Range) {
    return prisma.customerRequest.groupBy({
      by: ['status'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async conversationsByChannel(tenantId: string, businessId: string, range: Range) {
    return prisma.conversation.groupBy({
      by: ['channel'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async conversationsByStatus(tenantId: string, businessId: string, range: Range) {
    return prisma.conversation.groupBy({
      by: ['status'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async messagesByDirection(tenantId: string, businessId: string, range: Range) {
    return prisma.message.groupBy({
      by: ['direction'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  /** AI_ANALYZE rows only (spec §9-11) — never AI_TOOL_EXECUTION/AI_ESCALATION_* rows, which have their own outcome semantics. */
  async aiAnalyzeByOutcome(tenantId: string, businessId: string, range: Range) {
    return prisma.aiLog.groupBy({
      by: ['outcome'],
      where: withTenant(tenantId, { businessId, operation: AI_ANALYZE, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  /** Spec §10: real intent values only, never a hardcoded list — nulls (a fallback/failed analyze with no intent) are excluded, not counted as an intent. */
  async aiAnalyzeByIntent(tenantId: string, businessId: string, range: Range) {
    return prisma.aiLog.groupBy({
      by: ['intent'],
      where: withTenant(tenantId, { businessId, operation: AI_ANALYZE, intent: { not: null }, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  /** Spec §9: average of only the rows where confidence IS NOT NULL — never coerced to 0. */
  async aiAnalyzeAverageConfidence(tenantId: string, businessId: string, range: Range): Promise<number | null> {
    const result = await prisma.aiLog.aggregate({
      where: withTenant(tenantId, { businessId, operation: AI_ANALYZE, confidence: { not: null }, ...createdAtInRange(range) }),
      _avg: { confidence: true },
    })
    return result._avg?.confidence ?? null
  },

  /** Spec §23-24: genuine tool-execution log rows only (Prompt 13 already guarantees a log exists only for an actual attempt, never a gate rejection). */
  async toolExecutionsBySuccess(tenantId: string, businessId: string, range: Range) {
    return prisma.aiLog.groupBy({
      by: ['toolSuccess'],
      where: withTenant(tenantId, { businessId, operation: AI_TOOL_EXECUTION, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async toolExecutionsByName(tenantId: string, businessId: string, range: Range) {
    return prisma.aiLog.groupBy({
      by: ['toolName'],
      where: withTenant(tenantId, { businessId, operation: AI_TOOL_EXECUTION, toolName: { not: null }, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  /** Spec §12: period always applies to createdAt (creation date), never resolvedAt — documented explicitly, never mixed. */
  async escalationsByStatus(tenantId: string, businessId: string, range: Range) {
    return prisma.aiEscalation.groupBy({
      by: ['status'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async escalationsByPriority(tenantId: string, businessId: string, range: Range) {
    return prisma.aiEscalation.groupBy({
      by: ['priority'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  async appointmentsByStatus(tenantId: string, businessId: string, range: Range) {
    return prisma.appointment.groupBy({
      by: ['status'],
      where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }),
      _count: { _all: true },
    })
  },

  /** Spec §16: count of ServiceRecords CREATED in the period — archived or not (archiving only hides a record from the default list, it doesn't erase the historical fact of its creation). Revenue is a separate, more restrictive query below. */
  async serviceRecordCount(tenantId: string, businessId: string, range: Range): Promise<number> {
    return prisma.serviceRecord.count({ where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }) })
  },

  /** Spec §16: non-archived only, grouped by currency — never summed across currencies (`isArchived: false` is not optional here). */
  async serviceRecordRevenueByCurrency(tenantId: string, businessId: string, range: Range) {
    return prisma.serviceRecord.groupBy({
      by: ['currency'],
      where: withTenant(tenantId, { businessId, isArchived: false, ...createdAtInRange(range) }),
      _sum: { totalPrice: true },
    })
  },

  /** Spec §17: current operational snapshot — never period-bound. */
  async serviceSnapshot(tenantId: string, businessId: string): Promise<{ active: number; total: number }> {
    const [active, total] = await Promise.all([
      prisma.service.count({ where: withTenant(tenantId, { businessId, isActive: true }) }),
      prisma.service.count({ where: withTenant(tenantId, { businessId }) }),
    ])
    return { active, total }
  },

  /** Spec §18: `active` is a current snapshot (never period-bound); `new` is scoped to the period's createdAt. Never counts a deactivated customer as active. */
  async customerCounts(tenantId: string, businessId: string, range: Range): Promise<{ active: number; new: number }> {
    const [active, newCount] = await Promise.all([
      prisma.customer.count({ where: withTenant(tenantId, { businessId, isActive: true }) }),
      prisma.customer.count({ where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }) }),
    ])
    return { active, new: newCount }
  },

  /** Spec §19: same active-snapshot/new-in-period split as customers. */
  async vehicleCounts(tenantId: string, businessId: string, range: Range): Promise<{ active: number; new: number }> {
    const [active, newCount] = await Promise.all([
      prisma.vehicle.count({ where: withTenant(tenantId, { businessId, isActive: true }) }),
      prisma.vehicle.count({ where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }) }),
    ])
    return { active, new: newCount }
  },

  /**
   * Spec §20: uses the one genuinely reliable, direct relation —
   * `CustomerRequest.appointmentId` (a real FK, set only by
   * customerRequestService.ts when a request is actually converted) —
   * never a customerId+time-window heuristic. Both counts are scoped to
   * CustomerRequests CREATED in the period (a cohort conversion rate: "of
   * the requests opened in this window, how many are already linked to a
   * real appointment" — see analyticsService.ts's doc comment for the
   * documented limitation this implies).
   */
  async customerRequestConversion(tenantId: string, businessId: string, range: Range): Promise<{ total: number; withAppointment: number }> {
    const [total, withAppointment] = await Promise.all([
      prisma.customerRequest.count({ where: withTenant(tenantId, { businessId, ...createdAtInRange(range) }) }),
      prisma.customerRequest.count({
        where: withTenant(tenantId, { businessId, appointmentId: { not: null }, ...createdAtInRange(range) }),
      }),
    ])
    return { total, withAppointment }
  },

  // --- Time series (spec §25-27) ---------------------------------------
  //
  // Each stored `createdAt` is a `timestamp` column holding a UTC wall-clock
  // value (see prisma/migrations — plain TIMESTAMP(3), no time zone), so
  // `"createdAt" AT TIME ZONE 'UTC'` first reinterprets it as a real
  // `timestamptz` instant, and the outer `AT TIME ZONE $timezone` then
  // converts that instant to the Business's local wall-clock time — the
  // same "instant -> local calendar day" operation toBusinessLocalDateTime()
  // performs in application code, just done in SQL so the whole table isn't
  // pulled into Node to be grouped in memory. `timezone` and every other
  // interpolated value are bound query parameters via Prisma's tagged-
  // template $queryRaw (never string concatenation) — see spec §35's
  // "parameterized; no string interpolation from client input".

  customerRequestsByDay(tenantId: string, businessId: string, range: Range, timezone: string): Promise<DayBucket[]> {
    return prisma.$queryRaw<DayBucket[]>`
      SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS day, COUNT(*)::int AS count
      FROM customer_requests
      WHERE "tenantId" = ${tenantId} AND "businessId" = ${businessId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
      GROUP BY day
      ORDER BY day
    `
  },

  aiAnalysesByDay(tenantId: string, businessId: string, range: Range, timezone: string): Promise<DayBucket[]> {
    return prisma.$queryRaw<DayBucket[]>`
      SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS day, COUNT(*)::int AS count
      FROM ai_logs
      WHERE "tenantId" = ${tenantId} AND "businessId" = ${businessId} AND "operation" = 'AI_ANALYZE'
        AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
      GROUP BY day
      ORDER BY day
    `
  },

  escalationsByDay(tenantId: string, businessId: string, range: Range, timezone: string): Promise<DayBucket[]> {
    return prisma.$queryRaw<DayBucket[]>`
      SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS day, COUNT(*)::int AS count
      FROM ai_escalations
      WHERE "tenantId" = ${tenantId} AND "businessId" = ${businessId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
      GROUP BY day
      ORDER BY day
    `
  },

  appointmentsByDay(tenantId: string, businessId: string, range: Range, timezone: string): Promise<DayBucket[]> {
    return prisma.$queryRaw<DayBucket[]>`
      SELECT (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS day, COUNT(*)::int AS count
      FROM appointments
      WHERE "tenantId" = ${tenantId} AND "businessId" = ${businessId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
      GROUP BY day
      ORDER BY day
    `
  },
}
