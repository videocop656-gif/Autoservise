import { z } from 'zod'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)
const toUpperIfString = <T extends string | null | undefined>(val: T): T =>
  typeof val === 'string' ? (val.toUpperCase() as T) : val

const yearSchema = z.number().int().min(1886, 'Invalid year').max(2100, 'Invalid year')
const mileageSchema = z.number().int().min(0, 'Mileage cannot be negative').max(2_000_000, 'Mileage is unreasonably high')

export const createVehicleSchema = z.object({
  customerId: z.string().uuid('Invalid customer id'),
  make: z.string().trim().min(1, 'Make is required').max(100),
  model: z.string().trim().min(1, 'Model is required').max(100),
  year: yearSchema.nullable().optional(),
  licensePlate: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()).transform(toUpperIfString),
  vin: z.preprocess(emptyToNull, z.string().trim().max(50).nullable().optional()).transform(toUpperIfString),
  mileage: mileageSchema.nullable().optional(),
  notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
})

// customerId is intentionally excluded: re-assigning a vehicle to a
// different customer is not a supported operation at this stage (it would
// also require re-validating every Lead that references this vehicle).
export const updateVehicleSchema = z
  .object({
    make: z.string().trim().min(1, 'Make is required').max(100).optional(),
    model: z.string().trim().min(1, 'Model is required').max(100).optional(),
    year: yearSchema.nullable().optional(),
    licensePlate: z.preprocess(emptyToNull, z.string().trim().max(30).nullable().optional()).transform(toUpperIfString),
    vin: z.preprocess(emptyToNull, z.string().trim().max(50).nullable().optional()).transform(toUpperIfString),
    mileage: mileageSchema.nullable().optional(),
    notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const vehicleIdParamSchema = z.string().uuid()

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>
