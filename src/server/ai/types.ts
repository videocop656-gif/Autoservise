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

/** Business-safe context handed to the provider — see contextBuilder.ts for what is and isn't included. */
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
    name: string
    description: string | null
    priceFrom: string | null
    priceTo: string | null
    currency: string
    durationMinutes: number
  }[]
  knowledge: { title: string; content: string; category: string }[]
  rules: { name: string; description: string; category: string; priority: number }[]
  customer: { firstName: string; lastName: string | null; phone: string; email: string | null } | null
  vehicle: { make: string; model: string; year: number | null; licensePlate: string | null; mileage: number | null } | null
}

export interface AiHistoryMessage {
  direction: 'INBOUND' | 'OUTBOUND'
  content: string
}
