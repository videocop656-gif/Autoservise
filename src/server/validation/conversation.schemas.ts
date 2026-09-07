import { z } from 'zod'
import { ConversationChannel, ConversationStatus } from '@prisma/client'

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

const subjectSchema = z.preprocess(emptyToNull, z.string().trim().max(200).nullable().optional())

// Accepts a UTC ('Z') or explicit-offset ISO 8601 datetime, same convention
// as Appointment.startAt/endAt and CustomerRequest.requestedDate.
const isoDateTime = z.string().datetime({ offset: true, message: 'Invalid ISO 8601 datetime' }).transform((v) => new Date(v))
const optionalIsoDateTime = z.preprocess(emptyToNull, isoDateTime.nullable().optional())

export const createConversationSchema = z.object({
  customerId: optionalUuid('Invalid customer id'),
  customerRequestId: optionalUuid('Invalid customer request id'),
  channel: z.nativeEnum(ConversationChannel),
  subject: subjectSchema,
  startedAt: optionalIsoDateTime,
})

export const updateConversationSchema = z
  .object({
    customerId: optionalUuid('Invalid customer id'),
    customerRequestId: optionalUuid('Invalid customer request id'),
    subject: subjectSchema,
    status: z.nativeEnum(ConversationStatus).optional(),
    closedAt: optionalIsoDateTime,
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

export const conversationIdParamSchema = z.string().uuid()
export const conversationStatusFilterSchema = z.nativeEnum(ConversationStatus)
export const conversationChannelFilterSchema = z.nativeEnum(ConversationChannel)

export type CreateConversationInput = z.infer<typeof createConversationSchema>
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>
