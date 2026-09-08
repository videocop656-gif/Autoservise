import { z } from 'zod'
import {
  CustomerRequestStatus,
  ConversationChannel,
  ConversationStatus,
  AiLogOutcome,
  AiEscalationStatus,
  AiEscalationPriority,
  AppointmentStatus,
} from '@prisma/client'
import { ApiError } from '../lib/errors'

// Spec §1: minimum 7d/30d/90d, `today` added because it fits the existing
// period-bounds machinery for free (see analyticsService.ts's
// computePeriodBounds — it's just PERIOD_DAYS.today = 1). Default 30d.
export const DASHBOARD_PERIODS = ['today', '7d', '30d', '90d'] as const
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

const dashboardPeriodSchema = z.enum(DASHBOARD_PERIODS).default('30d')

/**
 * Parses `?period=` — never accepts `tenantId`/`businessId` from the client
 * (spec §2/§3): those always come from `requireAuth()`'s AuthContext, and
 * this function's signature has no way to receive them at all. An
 * unrecognized period value is a real 400, not a silent fallback to the
 * default (spec §38 test 24: "invalid period rejected").
 */
export function parseDashboardPeriod(raw: string | string[] | undefined): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw
  const result = dashboardPeriodSchema.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid period — expected one of: today, 7d, 30d, 90d')
  }
  return result.data
}

const countBySchema = <T extends z.ZodTypeAny>(keySchema: T, keyName: string) =>
  z.array(z.object({ [keyName]: keySchema, count: z.number().int().nonnegative() }).strict())

const dailySeriesSchema = z.array(
  z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().nonnegative() }).strict()
)

const revenueByCurrencySchema = z.array(z.object({ currency: z.string(), total: z.string() }).strict())

/**
 * Validates the ENTIRE dashboard API response before it's ever sent (spec
 * §33) — never an arbitrary/ad-hoc object. Every count is a plain
 * non-negative integer (already aggregated server-side — see §31/§35: this
 * schema has no room for a raw row array to sneak through), every rate is a
 * 0..1 fraction, and revenue is always a fixed-point string (§34), never a
 * float.
 */
export const dashboardResponseSchema = z
  .object({
    period: z.enum(DASHBOARD_PERIODS),
    range: z
      .object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
    customerRequests: z
      .object({
        total: z.number().int().nonnegative(),
        byStatus: countBySchema(z.nativeEnum(CustomerRequestStatus), 'status'),
      })
      .strict(),
    conversations: z
      .object({
        total: z.number().int().nonnegative(),
        byChannel: countBySchema(z.nativeEnum(ConversationChannel), 'channel'),
        byStatus: countBySchema(z.nativeEnum(ConversationStatus), 'status'),
      })
      .strict(),
    messages: z
      .object({
        total: z.number().int().nonnegative(),
        inbound: z.number().int().nonnegative(),
        outbound: z.number().int().nonnegative(),
      })
      .strict(),
    ai: z
      .object({
        totalAnalyses: z.number().int().nonnegative(),
        successful: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        escalated: z.number().int().nonnegative(),
        averageConfidence: z.number().min(0).max(1).nullable(),
        byIntent: countBySchema(z.string(), 'intent'),
        byOutcome: countBySchema(z.nativeEnum(AiLogOutcome), 'outcome'),
        successRate: z.number().min(0).max(1),
        escalationRate: z.number().min(0).max(1),
      })
      .strict(),
    tools: z
      .object({
        totalExecutions: z.number().int().nonnegative(),
        successful: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        byName: countBySchema(z.string(), 'tool'),
        successRate: z.number().min(0).max(1),
      })
      .strict(),
    escalations: z
      .object({
        total: z.number().int().nonnegative(),
        open: z.number().int().nonnegative(),
        inProgress: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
        byPriority: countBySchema(z.nativeEnum(AiEscalationPriority), 'priority'),
      })
      .strict(),
    appointments: z
      .object({
        total: z.number().int().nonnegative(),
        byStatus: countBySchema(z.nativeEnum(AppointmentStatus), 'status'),
        completed: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
        noShow: z.number().int().nonnegative(),
      })
      .strict(),
    serviceHistory: z
      .object({
        total: z.number().int().nonnegative(),
        revenueByCurrency: revenueByCurrencySchema,
      })
      .strict(),
    services: z.object({ active: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict(),
    customers: z.object({ active: z.number().int().nonnegative(), new: z.number().int().nonnegative() }).strict(),
    vehicles: z.object({ active: z.number().int().nonnegative(), new: z.number().int().nonnegative() }).strict(),
    conversion: z.object({ customerRequestToAppointment: z.number().min(0).max(1).nullable() }).strict(),
    customerRequestsByDay: dailySeriesSchema,
    aiAnalysesByDay: dailySeriesSchema,
    escalationsByDay: dailySeriesSchema,
    appointmentsByDay: dailySeriesSchema,
  })
  .strict()

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>
