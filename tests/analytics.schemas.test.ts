import { describe, it, expect } from 'vitest'
import { parseDashboardPeriod, dashboardResponseSchema, DASHBOARD_PERIODS } from '../src/server/validation/analytics.schemas'

describe('parseDashboardPeriod', () => {
  it('defaults to 30d when absent (spec §38 test 7)', () => {
    expect(parseDashboardPeriod(undefined)).toBe('30d')
  })

  it('accepts every documented period value', () => {
    for (const p of DASHBOARD_PERIODS) {
      expect(parseDashboardPeriod(p)).toBe(p)
    }
  })

  it('rejects an invalid period (spec §38 test 24)', () => {
    expect(() => parseDashboardPeriod('365d')).toThrow()
    expect(() => parseDashboardPeriod('')).toThrow()
    expect(() => parseDashboardPeriod('7D')).toThrow()
  })

  it('takes the first value when given an array (defensive — query parsers in this codebase never receive arrays for a single-value param, but never crash if one arrives)', () => {
    expect(parseDashboardPeriod(['7d', '30d'])).toBe('7d')
  })
})

function validResponse() {
  return {
    period: '30d' as const,
    range: { startDate: '2026-08-10', endDate: '2026-09-08' },
    customerRequests: { total: 0, byStatus: [] },
    conversations: { total: 0, byChannel: [], byStatus: [] },
    messages: { total: 0, inbound: 0, outbound: 0 },
    ai: {
      totalAnalyses: 0,
      successful: 0,
      failed: 0,
      rejected: 0,
      escalated: 0,
      averageConfidence: null,
      byIntent: [],
      byOutcome: [],
      successRate: 0,
      escalationRate: 0,
    },
    tools: { totalExecutions: 0, successful: 0, failed: 0, byName: [], successRate: 0 },
    escalations: { total: 0, open: 0, inProgress: 0, resolved: 0, cancelled: 0, byPriority: [] },
    appointments: { total: 0, byStatus: [], completed: 0, cancelled: 0, noShow: 0 },
    serviceHistory: { total: 0, revenueByCurrency: [] as { currency: string; total: string }[] },
    services: { active: 0, total: 0 },
    customers: { active: 0, new: 0 },
    vehicles: { active: 0, new: 0 },
    conversion: { customerRequestToAppointment: null },
    customerRequestsByDay: [],
    aiAnalysesByDay: [],
    escalationsByDay: [],
    appointmentsByDay: [],
  }
}

describe('dashboardResponseSchema', () => {
  it('accepts a well-formed, fully-zeroed empty response', () => {
    expect(() => dashboardResponseSchema.parse(validResponse())).not.toThrow()
  })

  it('accepts real enum breakdown values and a fixed-point revenue string', () => {
    const response = validResponse()
    response.customerRequests.byStatus = [{ status: 'NEW', count: 3 } as never]
    response.serviceHistory.revenueByCurrency = [{ currency: 'KZT', total: '125000.00' }]
    expect(() => dashboardResponseSchema.parse(response)).not.toThrow()
  })

  it('rejects an unknown top-level field — never an arbitrary/ad-hoc object (spec §33)', () => {
    const response = { ...validResponse(), tenantId: 'leaked' }
    expect(() => dashboardResponseSchema.parse(response)).toThrow()
  })

  it('rejects a raw floating-point revenue value instead of a fixed-point string (spec §34)', () => {
    const response = validResponse()
    // @ts-expect-error deliberately wrong type to prove the schema rejects it
    response.serviceHistory.revenueByCurrency = [{ currency: 'KZT', total: 125000.5 }]
    expect(() => dashboardResponseSchema.parse(response)).toThrow()
  })

  it('rejects a rate outside 0..1', () => {
    const response = validResponse()
    response.ai.successRate = 1.5
    expect(() => dashboardResponseSchema.parse(response)).toThrow()
  })

  it('rejects a negative count', () => {
    const response = validResponse()
    response.messages.total = -1
    expect(() => dashboardResponseSchema.parse(response)).toThrow()
  })
})
