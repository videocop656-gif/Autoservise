import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { makeAuthContext, makeBusiness } from './helpers/fixtures'

const mocks = vi.hoisted(() => ({
  customerRequestsByStatus: vi.fn(),
  conversationsByChannel: vi.fn(),
  conversationsByStatus: vi.fn(),
  messagesByDirection: vi.fn(),
  aiAnalyzeByOutcome: vi.fn(),
  aiAnalyzeByIntent: vi.fn(),
  aiAnalyzeAverageConfidence: vi.fn(),
  toolExecutionsBySuccess: vi.fn(),
  toolExecutionsByName: vi.fn(),
  escalationsByStatus: vi.fn(),
  escalationsByPriority: vi.fn(),
  appointmentsByStatus: vi.fn(),
  serviceRecordCount: vi.fn(),
  serviceRecordRevenueByCurrency: vi.fn(),
  serviceSnapshot: vi.fn(),
  customerCounts: vi.fn(),
  vehicleCounts: vi.fn(),
  customerRequestConversion: vi.fn(),
  customerRequestsByDay: vi.fn(),
  aiAnalysesByDay: vi.fn(),
  escalationsByDay: vi.fn(),
  appointmentsByDay: vi.fn(),
}))

vi.mock('../src/server/repositories/analyticsRepository', () => ({
  analyticsRepository: mocks,
}))

import { getDashboard, computePeriodBounds, fillDays, rate } from '../src/server/services/analyticsService'

function zeroGroupBy() {
  return []
}

function setAllZero() {
  mocks.customerRequestsByStatus.mockResolvedValue(zeroGroupBy())
  mocks.conversationsByChannel.mockResolvedValue(zeroGroupBy())
  mocks.conversationsByStatus.mockResolvedValue(zeroGroupBy())
  mocks.messagesByDirection.mockResolvedValue(zeroGroupBy())
  mocks.aiAnalyzeByOutcome.mockResolvedValue(zeroGroupBy())
  mocks.aiAnalyzeByIntent.mockResolvedValue(zeroGroupBy())
  mocks.aiAnalyzeAverageConfidence.mockResolvedValue(null)
  mocks.toolExecutionsBySuccess.mockResolvedValue(zeroGroupBy())
  mocks.toolExecutionsByName.mockResolvedValue(zeroGroupBy())
  mocks.escalationsByStatus.mockResolvedValue(zeroGroupBy())
  mocks.escalationsByPriority.mockResolvedValue(zeroGroupBy())
  mocks.appointmentsByStatus.mockResolvedValue(zeroGroupBy())
  mocks.serviceRecordCount.mockResolvedValue(0)
  mocks.serviceRecordRevenueByCurrency.mockResolvedValue([])
  mocks.serviceSnapshot.mockResolvedValue({ active: 0, total: 0 })
  mocks.customerCounts.mockResolvedValue({ active: 0, new: 0 })
  mocks.vehicleCounts.mockResolvedValue({ active: 0, new: 0 })
  mocks.customerRequestConversion.mockResolvedValue({ total: 0, withAppointment: 0 })
  mocks.customerRequestsByDay.mockResolvedValue([])
  mocks.aiAnalysesByDay.mockResolvedValue([])
  mocks.escalationsByDay.mockResolvedValue([])
  mocks.appointmentsByDay.mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  setAllZero()
})

describe('getDashboard — permissions', () => {
  it('allows owner, admin, and manager', async () => {
    for (const role of ['owner', 'admin', 'manager'] as const) {
      await expect(getDashboard(makeAuthContext(role), '30d')).resolves.toBeDefined()
    }
  })
})

describe('getDashboard — empty dataset (spec §38 test 10)', () => {
  it('returns a fully valid, all-zero response — never fake/sample data', async () => {
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.customerRequests).toEqual({ total: 0, byStatus: [] })
    expect(result.conversations).toEqual({ total: 0, byChannel: [], byStatus: [] })
    expect(result.messages).toEqual({ total: 0, inbound: 0, outbound: 0 })
    expect(result.ai.totalAnalyses).toBe(0)
    expect(result.ai.averageConfidence).toBeNull()
    expect(result.ai.successRate).toBe(0)
    expect(result.ai.escalationRate).toBe(0)
    expect(result.tools.successRate).toBe(0)
    expect(result.conversion.customerRequestToAppointment).toBe(0)
    expect(result.customerRequestsByDay.every((d) => d.count === 0)).toBe(true)
    expect(result.customerRequestsByDay).toHaveLength(30)
  })
})

describe('getDashboard — KPI aggregation from real breakdown shapes', () => {
  it('sums a multi-status customerRequests breakdown into the correct total', async () => {
    mocks.customerRequestsByStatus.mockResolvedValue([
      { status: 'NEW', _count: { _all: 5 } },
      { status: 'CONVERTED', _count: { _all: 2 } },
      { status: 'CANCELLED', _count: { _all: 1 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.customerRequests.total).toBe(8)
    expect(result.customerRequests.byStatus).toContainEqual({ status: 'NEW', count: 5 })
    expect(result.customerRequests.byStatus).toContainEqual({ status: 'CONVERTED', count: 2 })
  })

  it('never invents a status that was not in the real breakdown', async () => {
    mocks.customerRequestsByStatus.mockResolvedValue([{ status: 'NEW', _count: { _all: 1 } }])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.customerRequests.byStatus).toHaveLength(1)
  })

  it('computes messages.inbound/outbound/total from the direction breakdown', async () => {
    mocks.messagesByDirection.mockResolvedValue([
      { direction: 'INBOUND', _count: { _all: 7 } },
      { direction: 'OUTBOUND', _count: { _all: 4 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.messages).toEqual({ total: 11, inbound: 7, outbound: 4 })
  })

  it('extracts escalations.open/inProgress/resolved/cancelled from a real status breakdown, defaulting missing statuses to 0', async () => {
    mocks.escalationsByStatus.mockResolvedValue([
      { status: 'OPEN', _count: { _all: 3 } },
      { status: 'RESOLVED', _count: { _all: 2 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.escalations).toMatchObject({ total: 5, open: 3, inProgress: 0, resolved: 2, cancelled: 0 })
  })

  it('extracts appointments.completed/cancelled/noShow from a real status breakdown', async () => {
    mocks.appointmentsByStatus.mockResolvedValue([
      { status: 'SCHEDULED', _count: { _all: 4 } },
      { status: 'COMPLETED', _count: { _all: 6 } },
      { status: 'CANCELLED', _count: { _all: 1 } },
      { status: 'NO_SHOW', _count: { _all: 1 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.appointments).toMatchObject({ total: 12, completed: 6, cancelled: 1, noShow: 1 })
  })
})

describe('getDashboard — AI rates (spec §21/§22)', () => {
  it('computes successRate/escalationRate from the real outcome breakdown, never treating FAILED/REJECTED as SUCCESS', async () => {
    mocks.aiAnalyzeByOutcome.mockResolvedValue([
      { outcome: 'SUCCESS', _count: { _all: 6 } },
      { outcome: 'FAILED', _count: { _all: 2 } },
      { outcome: 'REJECTED', _count: { _all: 1 } },
      { outcome: 'ESCALATED', _count: { _all: 1 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.ai.totalAnalyses).toBe(10)
    expect(result.ai.successful).toBe(6)
    expect(result.ai.failed).toBe(2)
    expect(result.ai.rejected).toBe(1)
    expect(result.ai.escalated).toBe(1)
    expect(result.ai.successRate).toBeCloseTo(0.6)
    expect(result.ai.escalationRate).toBeCloseTo(0.1)
  })

  it('returns 0, never NaN, when there are zero AI_ANALYZE rows this period', async () => {
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.ai.successRate).toBe(0)
    expect(result.ai.escalationRate).toBe(0)
    expect(Number.isNaN(result.ai.successRate)).toBe(false)
  })

  it('never treats a null confidence as 0 — averageConfidence comes straight from the repository\'s already-filtered average', async () => {
    mocks.aiAnalyzeAverageConfidence.mockResolvedValue(0.73)
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.ai.averageConfidence).toBe(0.73)
  })

  it('sorts byIntent by count descending', async () => {
    mocks.aiAnalyzeByIntent.mockResolvedValue([
      { intent: 'PRICE_INQUIRY', _count: { _all: 2 } },
      { intent: 'BOOKING_REQUEST', _count: { _all: 9 } },
    ])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.ai.byIntent[0]).toEqual({ intent: 'BOOKING_REQUEST', count: 9 })
  })
})

describe('getDashboard — tool analytics (spec §23/§24)', () => {
  it('computes tools.successRate only from genuine execution log rows, and never fabricates a rate above the real data', async () => {
    mocks.toolExecutionsBySuccess.mockResolvedValue([
      { toolSuccess: true, _count: { _all: 3 } },
      { toolSuccess: false, _count: { _all: 1 } },
    ])
    mocks.toolExecutionsByName.mockResolvedValue([{ toolName: 'create_appointment', _count: { _all: 4 } }])
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.tools).toMatchObject({ totalExecutions: 4, successful: 3, failed: 1 })
    expect(result.tools.successRate).toBeCloseTo(0.75)
    expect(result.tools.byName).toEqual([{ tool: 'create_appointment', count: 4 }])
  })
})

describe('getDashboard — service history / revenue (spec §16/§34)', () => {
  it('serializes revenue as a fixed-point string per currency, never combining currencies', async () => {
    mocks.serviceRecordRevenueByCurrency.mockResolvedValue([
      { currency: 'KZT', _sum: { totalPrice: new Prisma.Decimal('125000') } },
      { currency: 'USD', _sum: { totalPrice: new Prisma.Decimal('300.5') } },
    ])
    mocks.serviceRecordCount.mockResolvedValue(7)
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.serviceHistory.total).toBe(7)
    expect(result.serviceHistory.revenueByCurrency).toEqual([
      { currency: 'KZT', total: '125000.00' },
      { currency: 'USD', total: '300.50' },
    ])
    expect(typeof result.serviceHistory.revenueByCurrency[0]!.total).toBe('string')
  })
})

describe('getDashboard — conversion (spec §20)', () => {
  it('computes a real cohort rate from CustomerRequest.appointmentId, never a heuristic match', async () => {
    mocks.customerRequestConversion.mockResolvedValue({ total: 4, withAppointment: 1 })
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.conversion.customerRequestToAppointment).toBeCloseTo(0.25)
  })

  it('returns 0 (never null) when there were no CustomerRequests in the period at all', async () => {
    const result = await getDashboard(makeAuthContext('owner'), '30d')
    expect(result.conversion.customerRequestToAppointment).toBe(0)
  })
})

describe('getDashboard — time series (spec §25/§26/§27)', () => {
  it('fills every day in the period, including days with zero events', async () => {
    mocks.customerRequestsByDay.mockResolvedValue([{ day: new Date('2026-09-08T00:00:00Z'), count: 3 }])
    const result = await getDashboard(makeAuthContext('owner'), '7d', new Date('2026-09-08T12:00:00Z'))
    expect(result.customerRequestsByDay).toHaveLength(7)
    expect(result.customerRequestsByDay.find((d) => d.date === '2026-09-08')?.count).toBe(3)
    expect(result.customerRequestsByDay.filter((d) => d.count === 0)).toHaveLength(6)
  })

  it('never double-counts across period boundaries — dateKeys are strictly increasing with no duplicates', async () => {
    const result = await getDashboard(makeAuthContext('owner'), '90d')
    const dates = result.appointmentsByDay.map((d) => d.date)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates).toEqual([...dates].sort())
  })
})

describe('rate()', () => {
  it('returns 0 for a zero denominator', () => {
    expect(rate(5, 0)).toBe(0)
  })
  it('returns the correct fraction otherwise', () => {
    expect(rate(1, 4)).toBe(0.25)
  })
})

describe('fillDays()', () => {
  it('fills missing days with 0 and preserves order', () => {
    const filled = fillDays(['2026-09-01', '2026-09-02', '2026-09-03'], [{ day: new Date('2026-09-02T00:00:00Z'), count: 5 }])
    expect(filled).toEqual([
      { date: '2026-09-01', count: 0 },
      { date: '2026-09-02', count: 5 },
      { date: '2026-09-03', count: 0 },
    ])
  })
})

describe('computePeriodBounds — timezone correctness (spec §1/§27/§28)', () => {
  it('7d/30d/90d/today each produce the documented number of calendar days', () => {
    expect(computePeriodBounds('today', 'UTC', new Date('2026-09-08T12:00:00Z')).dateKeys).toHaveLength(1)
    expect(computePeriodBounds('7d', 'UTC', new Date('2026-09-08T12:00:00Z')).dateKeys).toHaveLength(7)
    expect(computePeriodBounds('30d', 'UTC', new Date('2026-09-08T12:00:00Z')).dateKeys).toHaveLength(30)
    expect(computePeriodBounds('90d', 'UTC', new Date('2026-09-08T12:00:00Z')).dateKeys).toHaveLength(90)
  })

  it('UTC: "today" boundary is exactly UTC midnight to UTC midnight', () => {
    const bounds = computePeriodBounds('today', 'UTC', new Date('2026-09-08T15:00:00Z'))
    expect(bounds.start.toISOString()).toBe('2026-09-08T00:00:00.000Z')
    expect(bounds.end.toISOString()).toBe('2026-09-09T00:00:00.000Z')
    expect(bounds.dateKeys).toEqual(['2026-09-08'])
  })

  it('Europe/Moscow (UTC+3, no DST): a UTC evening instant is still "today" in Moscow, and the UTC boundary shifts back 3 hours', () => {
    // 23:30 UTC on the 7th is 02:30 on the 8th in Moscow — "today" must be the 8th, not the 7th.
    const bounds = computePeriodBounds('today', 'Europe/Moscow', new Date('2026-09-07T23:30:00Z'))
    expect(bounds.dateKeys).toEqual(['2026-09-08'])
    expect(bounds.start.toISOString()).toBe('2026-09-07T21:00:00.000Z')
    expect(bounds.end.toISOString()).toBe('2026-09-08T21:00:00.000Z')
  })

  it('Asia/Almaty (UTC+5): the same cross-midnight instant lands on the correct local day, distinctly from Moscow', () => {
    // 20:30 UTC is already 01:30 the next day in Almaty (+5).
    const bounds = computePeriodBounds('today', 'Asia/Almaty', new Date('2026-09-07T20:30:00Z'))
    expect(bounds.dateKeys).toEqual(['2026-09-08'])
    expect(bounds.start.toISOString()).toBe('2026-09-07T19:00:00.000Z')
    expect(bounds.end.toISOString()).toBe('2026-09-08T19:00:00.000Z')
  })

  it('never uses the server/machine local timezone as a source of truth — UTC and a real zone diverge on the same instant', () => {
    const now = new Date('2026-09-07T22:00:00Z') // 22:00 UTC on the 7th
    const utcBounds = computePeriodBounds('today', 'UTC', now)
    const moscowBounds = computePeriodBounds('today', 'Europe/Moscow', now)
    expect(utcBounds.dateKeys).toEqual(['2026-09-07'])
    expect(moscowBounds.dateKeys).toEqual(['2026-09-08'])
  })

  it('the [start, end) window is half-open — end is the exclusive start of the next local day, never included', () => {
    const bounds = computePeriodBounds('7d', 'Europe/Moscow', new Date('2026-09-08T10:00:00Z'))
    // end must equal the start of the day AFTER the last dateKey.
    const lastDateKey = bounds.dateKeys[bounds.dateKeys.length - 1]!
    expect(lastDateKey).toBe('2026-09-08')
    expect(bounds.end.toISOString()).toBe('2026-09-08T21:00:00.000Z')
  })
})

describe('getDashboard — passes the correctly-scoped range/timezone through to the repository', () => {
  it('passes Business.timezone (not UTC, not the server clock) to every day-bucket query', async () => {
    const ctx = makeAuthContext('owner', { business: makeBusiness({ timezone: 'Asia/Almaty' }) })
    await getDashboard(ctx, '7d', new Date('2026-09-08T10:00:00Z'))
    expect(mocks.customerRequestsByDay).toHaveBeenCalledWith(
      ctx.tenant.id,
      ctx.business.id,
      expect.any(Object),
      'Asia/Almaty'
    )
  })

  it('scopes every repository call to the authenticated tenant/business, never a client-supplied id', async () => {
    const ctx = makeAuthContext('owner')
    await getDashboard(ctx, '30d')
    expect(mocks.customerRequestsByStatus).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id, expect.any(Object))
    expect(mocks.serviceSnapshot).toHaveBeenCalledWith(ctx.tenant.id, ctx.business.id)
  })
})
