import { z } from 'zod'

// Every tool argument the model supplies is untrusted output until it
// passes these schemas — no tool ever executes on unvalidated input (spec
// §"OPENAI TOOL CALLING": "Validate every tool call server-side using Zod
// before execution").

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const optionalTime = (message: string) => z.preprocess(emptyToNull, z.string().regex(TIME_RE, message).nullable().optional())
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Same convention as Appointment.startAt/endAt (appointment.schemas.ts):
// UTC or explicit-offset ISO 8601 only, never a bare timezone-less string.
const isoDateTime = z.string().datetime({ offset: true, message: 'Invalid ISO 8601 datetime' }).transform((v) => new Date(v))

const notesSchema = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional())

export const checkAvailabilityToolSchema = z.object({
  customerId: optionalUuid('Invalid customer id'),
  vehicleId: optionalUuid('Invalid vehicle id'),
  serviceId: z.string().uuid('Invalid service id'),
  date: z.string().regex(DATE_RE, 'Invalid date — expected YYYY-MM-DD, in the business timezone'),
  preferredTimeFrom: optionalTime('Invalid preferredTimeFrom (expected HH:mm)'),
  preferredTimeTo: optionalTime('Invalid preferredTimeTo (expected HH:mm)'),
})

export const createAppointmentToolSchema = z.object({
  customerId: z.string().uuid('Invalid customer id'),
  vehicleId: z.string().uuid('Invalid vehicle id'),
  serviceId: z.string().uuid('Invalid service id'),
  startAt: isoDateTime,
  endAt: isoDateTime,
  notes: notesSchema,
})

export const rescheduleAppointmentToolSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment id'),
  startAt: isoDateTime,
  endAt: isoDateTime,
})

export const cancelAppointmentToolSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment id'),
})

export type CheckAvailabilityToolInput = z.infer<typeof checkAvailabilityToolSchema>
export type CreateAppointmentToolInput = z.infer<typeof createAppointmentToolSchema>
export type RescheduleAppointmentToolInput = z.infer<typeof rescheduleAppointmentToolSchema>
export type CancelAppointmentToolInput = z.infer<typeof cancelAppointmentToolSchema>
