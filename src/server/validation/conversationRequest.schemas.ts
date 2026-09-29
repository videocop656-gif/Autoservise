import { z } from 'zod'

// ---------------------------------------------------------------------------
// Prompt 49 — POST /api/conversations/:id/request ("Создать обращение").
//
// The operator-reviewed fields for a CustomerRequest created from a
// Conversation. Limits mirror customerRequest.schemas.ts exactly (so the
// request's own schema never rejects what passes here), with Russian
// messages because they are shown under the form fields. Everything else
// (source, initial status, the conversation link) is decided server-side.
// ---------------------------------------------------------------------------

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)
const optionalUuid = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable().optional())

export const createRequestFromConversationSchema = z.object({
  // Only used when the conversation has no customer yet; if it has one, that
  // customer is always reused (a different id here is rejected).
  customerId: optionalUuid('Некорректный клиент'),
  vehicleId: optionalUuid('Некорректный автомобиль'),
  serviceId: optionalUuid('Некорректная услуга'),
  subject: z
    .string({ required_error: 'Укажите тему обращения' })
    .trim()
    .min(2, 'Тема обращения слишком короткая')
    .max(200, 'Тема обращения не должна превышать 200 символов'),
  description: z.preprocess(
    emptyToNull,
    z.string().trim().max(10000, 'Описание не должно превышать 10 000 символов').nullable().optional()
  ),
})

export type CreateRequestFromConversationInput = z.infer<typeof createRequestFromConversationSchema>
