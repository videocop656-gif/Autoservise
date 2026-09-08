import { z } from 'zod'
import { AI_INTENTS } from './types'

// The MODEL's own output is untrusted structured data — this schema is the
// server-side gate every provider's response must pass before an AiResult
// is ever returned to a client (spec: "Результат должен проходить Zod
// validation on server side... Если validation failed: needsHuman = true").
// A validation failure never throws all the way to the HTTP layer — see
// aiService.ts's buildFallbackResult() — it degrades to a safe result
// instead, since the provider DID respond, just not usably.

const emptyToNull = (val: unknown): unknown => (typeof val === 'string' && val.trim() === '' ? null : val)

/** Entity normalization (spec §"Entity normalization"): blank strings become null, never a guessed value. */
const entityField = () => z.preprocess(emptyToNull, z.string().trim().nullable()).default(null)

export const aiEntitiesSchema = z.object({
  customerName: entityField(),
  phone: entityField(),
  vehicleMake: entityField(),
  vehicleModel: entityField(),
  licensePlate: entityField(),
  serviceName: entityField(),
  requestedDate: entityField(),
  requestedTime: entityField(),
})

export const aiResultSchema = z.object({
  intent: z.enum(AI_INTENTS),
  confidence: z.number().min(0).max(1),
  entities: aiEntitiesSchema,
  answer: z.string().trim().min(1),
  needsHuman: z.boolean(),
  reason: z.preprocess(emptyToNull, z.string().trim().nullable()).default(null),
})

export type ValidatedAiResult = z.infer<typeof aiResultSchema>

/**
 * Hand-written JSON Schema mirroring aiResultSchema above, for OpenAI's
 * Structured Outputs (response_format: json_schema). Not derived
 * automatically (no zod-to-json-schema dependency — see the "no
 * unnecessary dependencies" rule) — the two must be kept in sync by hand;
 * aiResultSchema.parse() is still the actual server-side gate regardless
 * of what the provider claims to guarantee.
 */
export const AI_RESULT_JSON_SCHEMA = {
  name: 'ai_result',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: [...AI_INTENTS] },
      confidence: { type: 'number' },
      entities: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customerName: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          vehicleMake: { type: ['string', 'null'] },
          vehicleModel: { type: ['string', 'null'] },
          licensePlate: { type: ['string', 'null'] },
          serviceName: { type: ['string', 'null'] },
          requestedDate: { type: ['string', 'null'] },
          requestedTime: { type: ['string', 'null'] },
        },
        required: [
          'customerName',
          'phone',
          'vehicleMake',
          'vehicleModel',
          'licensePlate',
          'serviceName',
          'requestedDate',
          'requestedTime',
        ],
      },
      answer: { type: 'string' },
      needsHuman: { type: 'boolean' },
      reason: { type: ['string', 'null'] },
    },
    required: ['intent', 'confidence', 'entities', 'answer', 'needsHuman', 'reason'],
  },
} as const
