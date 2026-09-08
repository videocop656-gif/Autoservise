import type { AuthContext } from '../types/auth'
import { requireRole } from '../middleware/requireRole'
import { toBusinessLocalDateTime, businessLocalToUtc } from '../lib/timezone'
import { analyticsRepository, type DayBucket } from '../repositories/analyticsRepository'
import { dashboardResponseSchema, type DashboardPeriod, type DashboardResponse } from '../validation/analytics.schemas'

// Same operational exception already established for every other AI/staff-
// facing domain (Appointment/Conversation/AI Core/Escalations/AI Logs) —
// manager gets full read access, never a Settings-only restriction.
const STAFF_ROLES = ['owner', 'admin', 'manager'] as const

const PERIOD_DAYS: Record<DashboardPeriod, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 }

/** Pure calendar-date arithmetic on a "YYYY-MM-DD" key — never a timezone operation itself (see computePeriodBounds for where the actual zone conversion happens). */
function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateKeyRange(startDateKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysToDateKey(startDateKey, i))
}

export interface PeriodBounds {
  /** Inclusive UTC lower bound for the [start, end) query window (spec §27). */
  start: Date
  /** Exclusive UTC upper bound. */
  end: Date
  /** Business-local "YYYY-MM-DD" for every day in the period, oldest first — used both for the response's `range` and to fill empty days in the time series. */
  dateKeys: string[]
}

/**
 * Interprets `period` relative to Business.timezone, never the server's own
 * clock timezone or a client-supplied one (spec §1) — "today" is always
 * "today in the business's own timezone". `now` is injectable for tests
 * (spec §28's timezone/midnight-boundary tests need a fixed instant).
 */
/** Exported for direct unit testing of the timezone/boundary math (spec §28) without mocking the full repository stack — same rationale as escalationService.ts's exported deriveEscalationReason/deriveEscalationSummary. */
export function computePeriodBounds(period: DashboardPeriod, timezone: string, now: Date): PeriodBounds {
  const todayKey = toBusinessLocalDateTime(now, timezone).dateKey
  const days = PERIOD_DAYS[period]
  const startDateKey = addDaysToDateKey(todayKey, -(days - 1))
  const endExclusiveDateKey = addDaysToDateKey(todayKey, 1)
  return {
    start: businessLocalToUtc(startDateKey, '00:00', timezone),
    end: businessLocalToUtc(endExclusiveDateKey, '00:00', timezone),
    dateKeys: dateKeyRange(startDateKey, days),
  }
}

/** Fills every day in the period with 0 when no row exists for it (spec §26) — the frontend never has to reconstruct a continuous timeline itself. Exported for direct unit testing. */
export function fillDays(dateKeys: string[], rows: DayBucket[]): { date: string; count: number }[] {
  const byDate = new Map<string, number>()
  for (const row of rows) {
    byDate.set(row.day.toISOString().slice(0, 10), row.count)
  }
  return dateKeys.map((date) => ({ date, count: byDate.get(date) ?? 0 }))
}

/** A 0..1 fraction; 0 (never NaN/null) when the denominator is 0 — spec §21/§22's documented, consistent choice. Exported for direct unit testing. */
export function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function countFor(rows: { count: number; key: string | boolean | null }[], key: string | boolean | null): number {
  return rows.find((r) => r.key === key)?.count ?? 0
}

function sumCounts(rows: { count: number }[]): number {
  return rows.reduce((total, r) => total + r.count, 0)
}

function sortByCountDesc<T extends { count: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.count - a.count)
}

export async function getDashboard(ctx: AuthContext, period: DashboardPeriod, now: Date = new Date()): Promise<DashboardResponse> {
  requireRole(ctx, ...STAFF_ROLES)

  const tenantId = ctx.tenant.id
  const businessId = ctx.business.id
  const timezone = ctx.business.timezone
  const bounds = computePeriodBounds(period, timezone, now)
  const range = { start: bounds.start, end: bounds.end }

  const [
    customerRequestsByStatusRaw,
    conversationsByChannelRaw,
    conversationsByStatusRaw,
    messagesByDirectionRaw,
    aiByOutcomeRaw,
    aiByIntentRaw,
    aiAverageConfidence,
    toolsBySuccessRaw,
    toolsByNameRaw,
    escalationsByStatusRaw,
    escalationsByPriorityRaw,
    appointmentsByStatusRaw,
    serviceHistoryTotal,
    revenueByCurrencyRaw,
    serviceSnapshot,
    customerCounts,
    vehicleCounts,
    conversionStats,
    customerRequestsByDayRaw,
    aiAnalysesByDayRaw,
    escalationsByDayRaw,
    appointmentsByDayRaw,
  ] = await Promise.all([
    analyticsRepository.customerRequestsByStatus(tenantId, businessId, range),
    analyticsRepository.conversationsByChannel(tenantId, businessId, range),
    analyticsRepository.conversationsByStatus(tenantId, businessId, range),
    analyticsRepository.messagesByDirection(tenantId, businessId, range),
    analyticsRepository.aiAnalyzeByOutcome(tenantId, businessId, range),
    analyticsRepository.aiAnalyzeByIntent(tenantId, businessId, range),
    analyticsRepository.aiAnalyzeAverageConfidence(tenantId, businessId, range),
    analyticsRepository.toolExecutionsBySuccess(tenantId, businessId, range),
    analyticsRepository.toolExecutionsByName(tenantId, businessId, range),
    analyticsRepository.escalationsByStatus(tenantId, businessId, range),
    analyticsRepository.escalationsByPriority(tenantId, businessId, range),
    analyticsRepository.appointmentsByStatus(tenantId, businessId, range),
    analyticsRepository.serviceRecordCount(tenantId, businessId, range),
    analyticsRepository.serviceRecordRevenueByCurrency(tenantId, businessId, range),
    analyticsRepository.serviceSnapshot(tenantId, businessId),
    analyticsRepository.customerCounts(tenantId, businessId, range),
    analyticsRepository.vehicleCounts(tenantId, businessId, range),
    analyticsRepository.customerRequestConversion(tenantId, businessId, range),
    analyticsRepository.customerRequestsByDay(tenantId, businessId, range, timezone),
    analyticsRepository.aiAnalysesByDay(tenantId, businessId, range, timezone),
    analyticsRepository.escalationsByDay(tenantId, businessId, range, timezone),
    analyticsRepository.appointmentsByDay(tenantId, businessId, range, timezone),
  ])

  const customerRequestsByStatus = customerRequestsByStatusRaw.map((r) => ({ status: r.status, count: r._count._all }))
  const conversationsByChannel = conversationsByChannelRaw.map((r) => ({ channel: r.channel, count: r._count._all }))
  const conversationsByStatus = conversationsByStatusRaw.map((r) => ({ status: r.status, count: r._count._all }))
  const messagesByDirection = messagesByDirectionRaw.map((r) => ({ key: r.direction, count: r._count._all }))

  const aiByOutcome = aiByOutcomeRaw.map((r) => ({ key: r.outcome, count: r._count._all }))
  const aiByIntent = aiByIntentRaw
    .filter((r): r is typeof r & { intent: string } => r.intent !== null)
    .map((r) => ({ intent: r.intent, count: r._count._all }))

  const toolsBySuccess = toolsBySuccessRaw.map((r) => ({ key: r.toolSuccess, count: r._count._all }))
  const toolsByName = toolsByNameRaw
    .filter((r): r is typeof r & { toolName: string } => r.toolName !== null)
    .map((r) => ({ tool: r.toolName, count: r._count._all }))

  const escalationsByStatus = escalationsByStatusRaw.map((r) => ({ key: r.status, count: r._count._all }))
  const escalationsByPriority = escalationsByPriorityRaw.map((r) => ({ priority: r.priority, count: r._count._all }))

  const appointmentsByStatus = appointmentsByStatusRaw.map((r) => ({ key: r.status, count: r._count._all }))

  const aiSuccessful = countFor(aiByOutcome, 'SUCCESS')
  const aiFailed = countFor(aiByOutcome, 'FAILED')
  const aiRejected = countFor(aiByOutcome, 'REJECTED')
  const aiEscalated = countFor(aiByOutcome, 'ESCALATED')
  // The true total of every AI_ANALYZE row this period, whatever outcome it
  // landed on — summing the full outcome breakdown rather than a separate
  // COUNT query, since the breakdown is already an exhaustive partition.
  const aiTotalAnalyses = sumCounts(aiByOutcome)

  const toolsSuccessful = countFor(toolsBySuccess, true)
  const toolsFailed = countFor(toolsBySuccess, false)
  const toolsTotal = toolsSuccessful + toolsFailed

  const escalationsTotal = sumCounts(escalationsByStatus)
  const appointmentsTotal = sumCounts(appointmentsByStatus)

  const response: DashboardResponse = {
    period,
    range: { startDate: bounds.dateKeys[0]!, endDate: bounds.dateKeys[bounds.dateKeys.length - 1]! },
    customerRequests: {
      total: sumCounts(customerRequestsByStatus),
      byStatus: sortByCountDesc(customerRequestsByStatus),
    },
    conversations: {
      total: sumCounts(conversationsByChannel),
      byChannel: sortByCountDesc(conversationsByChannel),
      byStatus: sortByCountDesc(conversationsByStatus),
    },
    messages: {
      total: sumCounts(messagesByDirection),
      inbound: countFor(messagesByDirection, 'INBOUND'),
      outbound: countFor(messagesByDirection, 'OUTBOUND'),
    },
    ai: {
      totalAnalyses: aiTotalAnalyses,
      successful: aiSuccessful,
      failed: aiFailed,
      rejected: aiRejected,
      escalated: aiEscalated,
      averageConfidence: aiAverageConfidence,
      byIntent: sortByCountDesc(aiByIntent),
      byOutcome: sortByCountDesc(aiByOutcome.map(({ key, count }) => ({ outcome: key, count }))),
      successRate: rate(aiSuccessful, aiTotalAnalyses),
      escalationRate: rate(aiEscalated, aiTotalAnalyses),
    },
    tools: {
      totalExecutions: toolsTotal,
      successful: toolsSuccessful,
      failed: toolsFailed,
      byName: sortByCountDesc(toolsByName),
      successRate: rate(toolsSuccessful, toolsTotal),
    },
    escalations: {
      total: escalationsTotal,
      open: countFor(escalationsByStatus, 'OPEN'),
      inProgress: countFor(escalationsByStatus, 'IN_PROGRESS'),
      resolved: countFor(escalationsByStatus, 'RESOLVED'),
      cancelled: countFor(escalationsByStatus, 'CANCELLED'),
      byPriority: sortByCountDesc(escalationsByPriority),
    },
    appointments: {
      total: appointmentsTotal,
      byStatus: sortByCountDesc(appointmentsByStatus.map(({ key, count }) => ({ status: key, count }))),
      completed: countFor(appointmentsByStatus, 'COMPLETED'),
      cancelled: countFor(appointmentsByStatus, 'CANCELLED'),
      noShow: countFor(appointmentsByStatus, 'NO_SHOW'),
    },
    serviceHistory: {
      total: serviceHistoryTotal,
      revenueByCurrency: revenueByCurrencyRaw.map((r) => ({
        currency: r.currency,
        total: (r._sum.totalPrice ?? 0).toFixed(2),
      })),
    },
    services: serviceSnapshot,
    customers: customerCounts,
    vehicles: vehicleCounts,
    conversion: {
      // Spec §20: null is reserved for "no reliable direct relationship
      // exists" — CustomerRequest.appointmentId IS that reliable relation
      // (a real FK, set only on genuine conversion — see
      // customerRequestService.ts), so it's used directly. 0 (never null)
      // when there were no CustomerRequests in the period at all, matching
      // the same "0 on empty denominator" convention as ai.successRate/
      // escalationRate. This is a cohort rate (both counts scoped to
      // requests CREATED in this period) — a request created just before
      // the period boundary that converts just after it will show as
      // "not converted" for this period; see the Final Report's Known
      // Limitations for why a different window wasn't used instead.
      customerRequestToAppointment: rate(conversionStats.withAppointment, conversionStats.total),
    },
    customerRequestsByDay: fillDays(bounds.dateKeys, customerRequestsByDayRaw),
    aiAnalysesByDay: fillDays(bounds.dateKeys, aiAnalysesByDayRaw),
    escalationsByDay: fillDays(bounds.dateKeys, escalationsByDayRaw),
    appointmentsByDay: fillDays(bounds.dateKeys, appointmentsByDayRaw),
  }

  // Spec §33: the entire response is validated against the Zod schema
  // before it's ever returned — never an ad-hoc object trusted as-is.
  return dashboardResponseSchema.parse(response)
}
