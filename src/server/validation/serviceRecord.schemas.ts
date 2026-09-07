import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '../domain/currency'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

// appointmentId goes through emptyToNull too, same as Lead's vehicleId/
// serviceId: a cleared <select> sends "", which means "no appointment",
// not a validation error.
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

const performedAtSchema = z
  .string()
  .datetime({ offset: true, message: 'Invalid ISO 8601 datetime' })
  .transform((v) => new Date(v))

const mileageSchema = z.number().int().min(0, 'Mileage cannot be negative').max(2_000_000, 'Mileage is unreasonably high')
const totalPriceSchema = z.number().finite('Price must be a finite number').nonnegative('Price cannot be negative').max(100_000_000)

const workDescriptionSchema = z.string().trim().min(1, 'Work description is required').max(10000)
const partsDescriptionSchema = z.preprocess(emptyToNull, z.string().trim().max(10000).nullable().optional())
const recommendationsSchema = z.preprocess(emptyToNull, z.string().trim().max(10000).nullable().optional())
const notesSchema = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional())

// isArchived is intentionally absent: a new record is always active (§14 —
// "CREATE endpoint НЕ должен принимать isArchived").
export const createServiceRecordSchema = z.object({
  customerId: z.string().uuid('Invalid customer id'),
  vehicleId: z.string().uuid('Invalid vehicle id'),
  serviceId: z.string().uuid('Invalid service id'),
  appointmentId: optionalUuid('Invalid appointment id'),
  performedAt: performedAtSchema,
  mileage: mileageSchema.nullable().optional(),
  totalPrice: totalPriceSchema,
  // Optional here, same convention as Service.currency: if omitted, the
  // service layer snapshots the current Business.currency at creation time.
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  workDescription: workDescriptionSchema,
  partsDescription: partsDescriptionSchema,
  recommendations: recommendationsSchema,
  notes: notesSchema,
})

export const updateServiceRecordSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id').optional(),
    vehicleId: z.string().uuid('Invalid vehicle id').optional(),
    serviceId: z.string().uuid('Invalid service id').optional(),
    appointmentId: optionalUuid('Invalid appointment id'),
    performedAt: performedAtSchema.optional(),
    mileage: mileageSchema.nullable().optional(),
    totalPrice: totalPriceSchema.optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    workDescription: workDescriptionSchema.optional(),
    partsDescription: partsDescriptionSchema,
    recommendations: recommendationsSchema,
    notes: notesSchema,
    // Archive/restore both go through this same PATCH — see §14.
    isArchived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const serviceRecordIdParamSchema = z.string().uuid()

export type CreateServiceRecordInput = z.infer<typeof createServiceRecordSchema>
export type UpdateServiceRecordInput = z.infer<typeof updateServiceRecordSchema>
