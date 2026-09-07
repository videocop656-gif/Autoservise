import { z } from 'zod'
import { CustomerRequestSource, CustomerRequestStatus } from '@prisma/client'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

// vehicleId/serviceId/appointmentId go through emptyToNull too, even though
// they're UUIDs: a naive client sending "" (a cleared <select>) means "no
// vehicle/service/appointment", not "give me a validation error" — same
// rule as every other optional relation field (see Lead/ServiceRecord).
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

// "HH:mm", zero-padded, hours 00-23, minutes 00-59 — same format as
// BusinessWorkingHours.openTime/closeTime. Cross-field ordering
// (requestedTimeFrom < requestedTimeTo) is checked in the object-level
// superRefine below (create) and re-checked against the *effective* merged
// values in the service layer (update, mirroring Appointment's startAt/
// endAt pattern — a PATCH may only touch one of the pair).
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const timeSchema = (message: string) => z.preprocess(emptyToNull, z.string().regex(TIME_RE, message).nullable().optional())

// Accepted as a validated ISO 8601 instant here; normalized to a
// Business-local *calendar date* (never a specific moment) in the service
// layer via toBusinessLocalDateTime, since Business.timezone isn't known at
// the schema layer — see normalizeRequestedDate() in customerRequestService.ts.
const requestedDateSchema = z.preprocess(
  emptyToNull,
  z.string().datetime({ offset: true, message: 'Invalid ISO 8601 datetime for requestedDate' }).nullable().optional()
)

const subjectSchema = z.string().trim().min(2, 'Subject is too short').max(200)
const descriptionSchema = z.preprocess(emptyToNull, z.string().trim().max(10000).nullable().optional())
const notesSchema = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional())

function addTimeRangeIssue(ctx: z.RefinementCtx): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'requestedTimeFrom must be before requestedTimeTo',
    path: ['requestedTimeTo'],
  })
}

// CREATE deliberately has no `status` field: a new request always starts at
// NEW (spec §17's own recommended simplification, to avoid hidden automatic
// transitions) — appointmentId can still be supplied at creation (to
// document a request that already resulted in a booking), but moving the
// status itself to QUALIFIED/CONVERTED is always a separate, explicit PATCH.
export const createCustomerRequestSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id'),
    vehicleId: optionalUuid('Invalid vehicle id'),
    serviceId: optionalUuid('Invalid service id'),
    appointmentId: optionalUuid('Invalid appointment id'),
    source: z.nativeEnum(CustomerRequestSource).optional(),
    subject: subjectSchema,
    description: descriptionSchema,
    requestedDate: requestedDateSchema,
    requestedTimeFrom: timeSchema('Invalid requestedTimeFrom (expected HH:mm)'),
    requestedTimeTo: timeSchema('Invalid requestedTimeTo (expected HH:mm)'),
    notes: notesSchema,
  })
  .superRefine((data, ctx) => {
    if (data.requestedTimeFrom && data.requestedTimeTo && data.requestedTimeFrom >= data.requestedTimeTo) {
      addTimeRangeIssue(ctx)
    }
  })

export const updateCustomerRequestSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id').optional(),
    vehicleId: optionalUuid('Invalid vehicle id'),
    serviceId: optionalUuid('Invalid service id'),
    appointmentId: optionalUuid('Invalid appointment id'),
    source: z.nativeEnum(CustomerRequestSource).optional(),
    status: z.nativeEnum(CustomerRequestStatus).optional(),
    subject: subjectSchema.optional(),
    description: descriptionSchema,
    requestedDate: requestedDateSchema,
    requestedTimeFrom: timeSchema('Invalid requestedTimeFrom (expected HH:mm)'),
    requestedTimeTo: timeSchema('Invalid requestedTimeTo (expected HH:mm)'),
    notes: notesSchema,
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })
  .superRefine((data, ctx) => {
    // Duration/order can only be fully checked here when BOTH ends of the
    // range are part of this particular PATCH; if only one changed, the
    // service layer re-validates using the existing value for the other.
    if (data.requestedTimeFrom === undefined || data.requestedTimeTo === undefined) return
    if (data.requestedTimeFrom && data.requestedTimeTo && data.requestedTimeFrom >= data.requestedTimeTo) {
      addTimeRangeIssue(ctx)
    }
  })

export const customerRequestIdParamSchema = z.string().uuid()
export const customerRequestStatusFilterSchema = z.nativeEnum(CustomerRequestStatus)
export const customerRequestSourceFilterSchema = z.nativeEnum(CustomerRequestSource)

export type CreateCustomerRequestInput = z.infer<typeof createCustomerRequestSchema>
export type UpdateCustomerRequestInput = z.infer<typeof updateCustomerRequestSchema>
