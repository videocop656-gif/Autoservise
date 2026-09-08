import type { AiToolDefinition } from '../types'

// Hand-written JSON Schema per tool, mirroring tools/schemas.ts — the same
// relationship aiResult.schema.ts's AI_RESULT_JSON_SCHEMA has with
// aiResultSchema. This is what the model is told it may call; the Zod
// schemas are what actually gates execution regardless of what the model
// sends. Every property is listed in `required` (nullable via
// `["type","null"]` for optional-in-spirit fields) because OpenAI's strict
// mode requires it — omission is expressed as an explicit `null` value,
// not a missing key.
export const TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: 'check_availability',
    description:
      'Get REAL available appointment time slots for a service on a given calendar date, in the business timezone. Never invent or guess a slot — only ever offer times this tool actually returned.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: ['string', 'null'], description: 'Known customer id from the business context, or null.' },
        vehicleId: { type: ['string', 'null'], description: 'Known vehicle id from the business context, or null.' },
        serviceId: { type: 'string', description: 'A real service id from the business context — never invented.' },
        date: { type: 'string', description: 'Calendar date in the business timezone, formatted YYYY-MM-DD.' },
        preferredTimeFrom: { type: ['string', 'null'], description: '"HH:mm", or null.' },
        preferredTimeTo: { type: ['string', 'null'], description: '"HH:mm", or null.' },
      },
      required: ['customerId', 'vehicleId', 'serviceId', 'date', 'preferredTimeFrom', 'preferredTimeTo'],
    },
  },
  {
    name: 'create_appointment',
    description:
      'Create a REAL appointment. Only call this after the customer has EXPLICITLY confirmed one specific slot that check_availability actually returned. Never call this merely because a time was mentioned, asked about, or preferred.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        customerId: { type: 'string', description: 'Known customer id from the business context — never invented.' },
        vehicleId: { type: 'string', description: 'Known vehicle id from the business context — never invented.' },
        serviceId: { type: 'string', description: 'A real service id from the business context — never invented.' },
        startAt: { type: 'string', description: 'ISO 8601 datetime with UTC/offset, exactly matching a slot check_availability returned.' },
        endAt: { type: 'string', description: 'ISO 8601 datetime with UTC/offset, exactly matching a slot check_availability returned.' },
        notes: { type: ['string', 'null'] },
      },
      required: ['customerId', 'vehicleId', 'serviceId', 'startAt', 'endAt', 'notes'],
    },
  },
  {
    name: 'reschedule_appointment',
    description:
      'Move an existing appointment to a new time. Only call this after identifying the specific appointment, checking availability for the new time, offering it, and receiving EXPLICIT customer confirmation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        appointmentId: { type: 'string', description: 'A real appointment id from the business context (upcomingAppointments) — never invented.' },
        startAt: { type: 'string', description: 'ISO 8601 datetime with UTC/offset for the new start time.' },
        endAt: { type: 'string', description: 'ISO 8601 datetime with UTC/offset for the new end time.' },
      },
      required: ['appointmentId', 'startAt', 'endAt'],
    },
  },
  {
    name: 'cancel_appointment',
    description:
      'Cancel an existing appointment (sets its status to CANCELLED; it is never deleted). Only call this after identifying the specific appointment and receiving EXPLICIT customer confirmation of the cancellation.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        appointmentId: { type: 'string', description: 'A real appointment id from the business context (upcomingAppointments) — never invented.' },
      },
      required: ['appointmentId'],
    },
  },
]
