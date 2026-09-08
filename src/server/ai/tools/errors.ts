import { ApiError } from '../../lib/errors'
import type { ToolResult } from '../types'

/**
 * appointmentService.ts uses a single generic VALIDATION_ERROR code for
 * every 400 (it always has, since Prompt 05 — the message text is what
 * actually distinguishes them). Rather than changing that established
 * REST error contract just for the Tool Layer's benefit, this maps the
 * exact, stable message strings it's known to throw onto the more
 * specific tool error codes the spec asks for. Anything unrecognized
 * falls back to INVALID_INPUT — still a safe, controlled result, never a
 * raw error.
 */
const MESSAGE_TO_ERROR_CODE: [RegExp, string][] = [
  [/Customer is not active/, 'CUSTOMER_INACTIVE'],
  [/Vehicle is not active/, 'VEHICLE_INACTIVE'],
  [/Service is not active/, 'SERVICE_INACTIVE'],
  [/working hours|closed on this day|cross local midnight/i, 'OUTSIDE_WORKING_HOURS'],
  [/Cannot modify a \w+ appointment's time or relations/, 'APPOINTMENT_NOT_RESCHEDULABLE'],
  [/Cannot change appointment status/, 'APPOINTMENT_NOT_CANCELLABLE'],
]

/**
 * Converts whatever a reused Appointment/Booking service function threw
 * into the tool's own structured failure result — never a raw error,
 * stack trace, or Prisma detail. Only ever called from within a tool
 * executor's try/catch around the real service call, so `attempted` is
 * always true here — the underlying business logic genuinely ran and
 * failed, which is exactly what aiLogService.ts's AI_TOOL_EXECUTION/FAILED
 * logging (Prompt 13) needs to distinguish from a gate rejection below.
 */
export function toToolFailure(toolName: string, err: unknown): ToolResult {
  if (err instanceof ApiError) {
    if (err.statusCode === 404) {
      return { success: false, tool: toolName, errorCode: 'NOT_FOUND', message: err.message, attempted: true }
    }
    if (err.code === 'APPOINTMENT_CONFLICT') {
      return { success: false, tool: toolName, errorCode: 'APPOINTMENT_CONFLICT', message: err.message, retryable: true, attempted: true }
    }
    if (err.statusCode === 403) {
      return { success: false, tool: toolName, errorCode: 'FORBIDDEN', message: err.message, attempted: true }
    }
    for (const [pattern, code] of MESSAGE_TO_ERROR_CODE) {
      if (pattern.test(err.message)) {
        return { success: false, tool: toolName, errorCode: code, message: err.message, attempted: true }
      }
    }
    return { success: false, tool: toolName, errorCode: 'INVALID_INPUT', message: err.message, attempted: true }
  }
  return { success: false, tool: toolName, errorCode: 'INVALID_INPUT', message: 'Unexpected error executing tool', attempted: true }
}

/** A gate rejection — the confirmation check ran before the real service was ever called. `attempted: false` (Prompt 13: never logged as a tool execution). */
export function confirmationRequired(toolName: string): ToolResult {
  return {
    success: false,
    tool: toolName,
    errorCode: 'CONFIRMATION_REQUIRED',
    message: 'Explicit customer confirmation is required before this action can be performed',
    retryable: true,
    attempted: false,
  }
}

/** A gate rejection — Zod validation failed before the real service was ever called. `attempted: false` (Prompt 13: never logged as a tool execution). */
export function invalidInput(toolName: string, message: string): ToolResult {
  return { success: false, tool: toolName, errorCode: 'INVALID_INPUT', message, attempted: false }
}

/**
 * A gate rejection — the tool call targeted a real, same-tenant entity
 * just not one this conversation is actually about, caught before the
 * real service was ever called. Never a 404 (that would suggest the id
 * doesn't exist at all, which isn't the issue here). `attempted: false`
 * (Prompt 13: never logged as a tool execution).
 */
export function forbiddenEntity(toolName: string, message: string): ToolResult {
  return { success: false, tool: toolName, errorCode: 'FORBIDDEN', message, attempted: false }
}
