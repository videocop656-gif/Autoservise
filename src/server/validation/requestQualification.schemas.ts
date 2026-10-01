import { z } from 'zod'

// Prompt 55 — POST /api/conversations/:id/qualification.
//   { action: "analyze" }  → AI proposal (no write)
//   { action: "create" | "update", … } → the operator-reviewed proposal,
//   persisted through the canonical CustomerRequest paths.
// Every id here comes from the operator's reviewed form and is re-checked
// server-side (tenant, the conversation's customer, active service).

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)
const uuidOrNull = (message: string) => z.preprocess(emptyToNull, z.string().uuid(message).nullable())
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const reviewedFields = {
  /** What the operator saw when reviewing — any change since is a 409, never a silent overwrite. */
  expectedCustomerId: uuidOrNull('Некорректный клиент'),
  vehicleId: uuidOrNull('Некорректный автомобиль').optional(),
  serviceId: uuidOrNull('Некорректная услуга').optional(),
  subject: z
    .string({ required_error: 'Укажите тему обращения' })
    .trim()
    .min(2, 'Тема обращения слишком короткая')
    .max(200, 'Тема обращения не должна превышать 200 символов'),
  description: z.preprocess(emptyToNull, z.string().trim().max(10000, 'Описание не должно превышать 10 000 символов').nullable().optional()),
  /** Business-local calendar date "YYYY-MM-DD". */
  requestedDate: z.preprocess(emptyToNull, z.string().regex(DATE_RE, 'Некорректная дата').nullable().optional()),
  requestedTimeFrom: z.preprocess(emptyToNull, z.string().regex(TIME_RE, 'Некорректное время').nullable().optional()),
  requestedTimeTo: z.preprocess(emptyToNull, z.string().regex(TIME_RE, 'Некорректное время').nullable().optional()),
}

export const requestQualificationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('analyze') }),
  z.object({ action: z.literal('create'), ...reviewedFields }),
  z.object({
    action: z.literal('update'),
    ...reviewedFields,
    expectedRequestId: z.string().uuid('Некорректное обращение'),
    /** The request's updatedAt when the proposal was built. */
    expectedRequestUpdatedAt: z.string().datetime({ message: 'Некорректная отметка времени' }),
  }),
])

export type RequestQualificationActionInput = z.infer<typeof requestQualificationActionSchema>
export type ApplyQualificationInput = Exclude<RequestQualificationActionInput, { action: 'analyze' }>
