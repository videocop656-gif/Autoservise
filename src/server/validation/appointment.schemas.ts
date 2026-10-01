import { z } from 'zod'
import { AppointmentStatus } from '@prisma/client'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

const MIN_DURATION_MS = 15 * 60 * 1000
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

// Accepts a UTC ('Z') or explicit-offset ISO 8601 datetime and turns it into
// a real Date. Never accepts a bare timezone-less string — the whole point
// is that ambiguity about "which timezone" never enters this layer; that's
// resolved later, purely from Business.timezone.
const isoDateTime = z.string().datetime({ offset: true, message: 'Invalid ISO 8601 datetime' }).transform((v) => new Date(v))

// Only SCHEDULED is creatable — an appointment can't be born already
// confirmed/in-progress/completed/cancelled/no-show (see spec §17).
const CREATABLE_STATUSES = ['SCHEDULED'] as const

const notesSchema = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional())

export const createAppointmentSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id'),
    vehicleId: z.string().uuid('Invalid vehicle id'),
    serviceId: z.string().uuid('Invalid service id'),
    startAt: isoDateTime,
    endAt: isoDateTime,
    status: z.enum(CREATABLE_STATUSES).optional(),
    notes: notesSchema,
  })
  .superRefine((data, ctx) => {
    const duration = data.endAt.getTime() - data.startAt.getTime()
    if (duration <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endAt must be after startAt', path: ['endAt'] })
      return
    }
    if (duration < MIN_DURATION_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Appointment must be at least 15 minutes', path: ['endAt'] })
    }
    if (duration > MAX_DURATION_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Appointment cannot exceed 24 hours', path: ['endAt'] })
    }
  })

export const updateAppointmentSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id').optional(),
    vehicleId: z.string().uuid('Invalid vehicle id').optional(),
    serviceId: z.string().uuid('Invalid service id').optional(),
    startAt: isoDateTime.optional(),
    endAt: isoDateTime.optional(),
    status: z.nativeEnum(AppointmentStatus).optional(),
    notes: notesSchema,
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })
  .superRefine((data, ctx) => {
    // Duration can only be fully checked here when BOTH ends of the
    // interval are part of this particular PATCH; if only one changed, the
    // service layer re-validates using the existing value for the other.
    if (data.startAt === undefined || data.endAt === undefined) return
    const duration = data.endAt.getTime() - data.startAt.getTime()
    if (duration <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endAt must be after startAt', path: ['endAt'] })
      return
    }
    if (duration < MIN_DURATION_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Appointment must be at least 15 minutes', path: ['endAt'] })
    }
    if (duration > MAX_DURATION_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Appointment cannot exceed 24 hours', path: ['endAt'] })
    }
  })

// Prompt 50 — GET /api/appointments/availability query. Same datetime and
// "" = not given conventions as the create/update schemas; endAt is
// optional (startAt + Service.durationMinutes otherwise). Duration limits
// are enforced by checkIntervalAvailability via the shared assertDuration.
const optionalQueryUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

export const intervalAvailabilityQuerySchema = z.object({
  serviceId: z.string().uuid('Invalid service id'),
  startAt: isoDateTime,
  endAt: z.preprocess(emptyToNull, isoDateTime.nullable().optional()),
  vehicleId: optionalQueryUuid('Invalid vehicle id'),
  excludeAppointmentId: optionalQueryUuid('Invalid appointment id'),
})

// Prompt 51 — the same endpoint's day mode: every bookable slot of one
// Business-local calendar date ("YYYY-MM-DD", never a UTC timestamp) for one
// service, optionally for one vehicle and excluding the appointment being
// rescheduled. Served by the existing slot generator (checkAvailability).
export const dayAvailabilityQuerySchema = z.object({
  serviceId: z.string().uuid('Invalid service id'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date — expected YYYY-MM-DD'),
  vehicleId: optionalQueryUuid('Invalid vehicle id'),
  excludeAppointmentId: optionalQueryUuid('Invalid appointment id'),
})

export const appointmentIdParamSchema = z.string().uuid()
export const appointmentStatusFilterSchema = z.nativeEnum(AppointmentStatus)

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>
