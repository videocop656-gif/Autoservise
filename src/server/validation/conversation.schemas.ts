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

// Prompt 49.1 — the Conversation → CustomerRequest link is written only by the
// "Создать обращение" bridge (conversationRequestService.ts). Rejected here
// explicitly rather than silently stripped (the channel/team convention):
// a PATCH { status, customerRequestId: null } must not answer 200 as if the
// link had been removed. Any value — a UUID, null, "" — is refused.
export const PROTECTED_REQUEST_LINK_MESSAGE = 'Связь диалога с обращением нельзя изменить или удалить'

export const updateConversationSchema = z
  .object({
    customerId: optionalUuid('Invalid customer id'),
    customerRequestId: z.undefined({ invalid_type_error: PROTECTED_REQUEST_LINK_MESSAGE }).optional(),
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
