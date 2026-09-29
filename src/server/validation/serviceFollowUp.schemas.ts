import { z } from 'zod'
import { ServiceFollowUpStatus } from '@prisma/client'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

/**
 * A Business-local calendar day, "YYYY-MM-DD" (Prompt 48). Follow-up due
 * dates are whole days in the Business's own timezone, never a browser-
 * local instant — the service layer converts it to the stored UTC instant
 * (local midnight) with Business.timezone. Rejects impossible dates like
 * 2026-02-30, not just malformed strings.
 */
export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number)
    const date = new Date(Date.UTC(y!, m! - 1, d!))
    return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
  }, 'Invalid calendar date')

/**
 * The "Следующий контакт" value on a ServiceRecord create/update:
 *   omitted   → create: use the service's repeat interval (if any);
 *               update: leave the follow-up untouched.
 *   "YYYY-MM-DD" → this exact day; always wins over the interval.
 *   null / "" → no follow-up (on update: dismisses a PENDING one).
 */
export const followUpDueDateSchema = z.preprocess(emptyToNull, businessDateSchema.nullable().optional())

const noteSchema = z.preprocess(emptyToNull, z.string().trim().max(2000).nullable().optional())

// Only status, dueAt and note are editable (spec §11). Status always goes
// through the service layer's transition matrix — never a raw write.
export const updateServiceFollowUpSchema = z
  .object({
    status: z.nativeEnum(ServiceFollowUpStatus).optional(),
    dueAt: businessDateSchema.optional(),
    note: noteSchema,
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const serviceFollowUpStatusQuerySchema = z.nativeEnum(ServiceFollowUpStatus)

export const serviceFollowUpIdParamSchema = z.string().uuid()

export type UpdateServiceFollowUpInput = z.infer<typeof updateServiceFollowUpSchema>
