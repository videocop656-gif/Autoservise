import { z } from 'zod'
import { LeadStatus, LeadSource } from '@prisma/client'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

// vehicleId/serviceId go through emptyToNull too, even though they're UUIDs:
// a naive client sending "" (a cleared <select>) means "no vehicle/service",
// not "give me a validation error" — same rule as every other optional field.
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

export const createLeadSchema = z.object({
  customerId: z.string().uuid('Invalid customer id'),
  vehicleId: optionalUuid('Invalid vehicle id'),
  serviceId: optionalUuid('Invalid service id'),
  subject: z.string().trim().min(2, 'Subject is too short').max(200),
  description: z.preprocess(emptyToNull, z.string().trim().max(10000).nullable().optional()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
})

export const updateLeadSchema = z
  .object({
    customerId: z.string().uuid('Invalid customer id').optional(),
    vehicleId: optionalUuid('Invalid vehicle id'),
    serviceId: optionalUuid('Invalid service id'),
    subject: z.string().trim().min(2, 'Subject is too short').max(200).optional(),
    description: z.preprocess(emptyToNull, z.string().trim().max(10000).nullable().optional()),
    notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional()),
    status: z.nativeEnum(LeadStatus).optional(),
    source: z.nativeEnum(LeadSource).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const leadIdParamSchema = z.string().uuid()
export const leadStatusFilterSchema = z.nativeEnum(LeadStatus)
export const leadSourceFilterSchema = z.nativeEnum(LeadSource)

export type CreateLeadInput = z.infer<typeof createLeadSchema>
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>
