// AI Core domain types (Prompt 09). Deliberately plain TypeScript/Zod, not
// Prisma — nothing here is persisted (see spec: "0 новых database models").

/**
 * Fixed classification set. Intent is a classification only — it never
 * triggers any action by itself (no Appointment is created/changed for a
 * BOOKING_REQUEST, etc.); acting on an intent is explicitly Prompt 10+'s
 * Tool Layer.
 */
export const AI_INTENTS = [
  'GENERAL_QUESTION',
  'SERVICE_INQUIRY',
  'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY',
  'BOOKING_REQUEST',
  'RESCHEDULE_REQUEST',
  'CANCELLATION_REQUEST',
  'VEHICLE_PROBLEM',
  'SERVICE_HISTORY_INQUIRY',
  'WARRANTY_INQUIRY',
  'CUSTOMER_INFORMATION',
  'UNKNOWN',
] as const

export type AiIntent = (typeof AI_INTENTS)[number]

export interface AiEntities {
  customerName: string | null
  phone: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  licensePlate: string | null
  serviceName: string | null
  requestedDate: string | null
  requestedTime: string | null
}

export const EMPTY_AI_ENTITIES: AiEntities = {
  customerName: null,
  phone: null,
  vehicleMake: null,
  vehicleModel: null,
  licensePlate: null,
  serviceName: null,
  requestedDate: null,
  requestedTime: null,
}

export interface AiResult {
  intent: AiIntent
  confidence: number
  entities: AiEntities
  answer: string
  needsHuman: boolean
  reason: string | null
}

/**
 * Business-safe context handed to the provider — see contextBuilder.ts for
 * what is and isn't included.
 *
 * Prompt 10 note: `services[].id`/`customer.id`/`vehicle.id` were added so
 * the AI can actually *reference* a specific entity when constructing a
 * tool call (Prompt 09 deliberately omitted every internal id). A
 * catalog/customer/vehicle id is not secret the way tenantId/businessId or
 * a session token are — it's the same kind of id every DTO in this app
 * already returns to the frontend — and the Tool Layer re-validates every
 * id against the real tenant-scoped data regardless of what the model
 * supplies, so this never becomes a trust boundary.
 */
export interface AiBusinessContext {
  business: {
    name: string
    description: string | null
    phone: string | null
    email: string | null
    address: string | null
    timezone: string
    currency: string
  }
  services: {
    id: string
    name: string
    description: string | null
    priceFrom: string | null
    priceTo: string | null
    currency: string
    durationMinutes: number
  }[]
  knowledge: { title: string; content: string; category: string }[]
  rules: { name: string; description: string; category: string; priority: number }[]
  customer: { id: string; firstName: string; lastName: string | null; phone: string; email: string | null } | null
  vehicle: {
    id: string
    make: string
    model: string
    year: number | null
    licensePlate: string | null
    mileage: number | null
  } | null
  /**
   * The known vehicle's upcoming, non-cancelled appointments — the only
   * way the AI can reference a specific appointment for
   * reschedule_appointment/cancel_appointment (spec: "AI must not control
   * IDs arbitrarily"). Empty whenever no vehicle is known. Deliberately
   * small and bounded (see contextBuilder.ts) — this is not a general
   * appointment-history feature.
   */
  upcomingAppointments: {
    id: string
    serviceName: string
    startAtLocal: string
    endAtLocal: string
    status: string
  }[]
}

export interface AiHistoryMessage {
  direction: 'INBOUND' | 'OUTBOUND'
  content: string
}

// --- Tool Layer (Prompt 10) ------------------------------------------------
//
// AI → Tool Layer → Booking Service → Prisma. The model never gets Prisma
// access, never gets to invent a tool, and every tool argument is
// Zod-validated server-side before anything executes — see
// src/server/ai/tools/registry.ts.

/** No dynamic tool loading, no model-generated tool names — this whitelist is the only thing that can ever execute. */
export const AI_TOOL_NAMES = ['check_availability', 'create_appointment', 'reschedule_appointment', 'cancel_appointment'] as const
export type AiToolName = (typeof AI_TOOL_NAMES)[number]

/** Sent to the provider so it knows what it may call — the model never sees Prisma, SQL, or any other capability. */
export interface AiToolDefinition {
  name: AiToolName
  description: string
  /** JSON Schema, hand-written (mirrors tools/schemas.ts, the same relationship aiResult.schema.ts's JSON_SCHEMA has with aiResultSchema). */
  parameters: Record<string, unknown>
}

/** What the provider asked to call — `name`/`arguments` are untrusted model output until the registry validates them. */
export interface AiToolCallRequest {
  id: string
  name: string
  arguments: unknown
}

/**
 * Never a raw database object, never a Prisma row — every tool always
 * returns one of these two shapes (spec §"TOOL EXECUTION CONTRACT").
 */
export type ToolResult =
  | { success: true; tool: string; data: unknown }
  | { success: false; tool: string; errorCode: string; message: string; retryable?: boolean }

/** One resolved round of the tool-calling loop, fed back to the provider on the next round. */
export interface AiToolExchange {
  call: AiToolCallRequest
  result: ToolResult
}

/**
 * The only customer/vehicle/appointment ids a MUTATING tool call
 * (create/reschedule/cancel) is allowed to reference this request —
 * derived straight from the already-resolved AiBusinessContext, never
 * from the model's tool-call arguments. This is what actually stops a
 * prompt-injection attempt like "create an appointment for another
 * customer": even if a compromised or confused model supplies a
 * different (but real, same-tenant) customerId/vehicleId/appointmentId,
 * the Tool Registry rejects it here before appointmentService.ts is ever
 * called — a model tool call is never itself sufficient authorization
 * (spec §"AI MUST NOT CONTROL IDS ARBITRARILY" / §"PROMPT INJECTION").
 * check_availability is unaffected — it's read-only and has no side
 * effect to protect against.
 */
export interface AiToolAllowedEntities {
  customerId: string | null
  vehicleId: string | null
  appointmentIds: string[]
}
