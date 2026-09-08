import type { AuthContext } from '../../types/auth'
import type { ToolResult, AiToolAllowedEntities } from '../types'
import { TOOL_DEFINITIONS } from './definitions'
import { executeCheckAvailability, CHECK_AVAILABILITY_TOOL_NAME } from './checkAvailabilityTool'
import { executeCreateAppointment, CREATE_APPOINTMENT_TOOL_NAME } from './createAppointmentTool'
import { executeRescheduleAppointment, RESCHEDULE_APPOINTMENT_TOOL_NAME } from './rescheduleAppointmentTool'
import { executeCancelAppointment, CANCEL_APPOINTMENT_TOOL_NAME } from './cancelAppointmentTool'

type ToolExecutor = (ctx: AuthContext, args: unknown, currentUserMessage: string, allowed: AiToolAllowedEntities) => Promise<ToolResult>

/**
 * The ONLY tools that can ever execute (spec §"TOOL WHITELIST") — no
 * dynamic loading, no model-generated names, no eval. A name that isn't a
 * key of this object is rejected before anything runs, regardless of how
 * plausible it looks. check_availability ignores `allowed` (it's
 * read-only); the three mutating tools all use it to reject a target
 * entity that isn't the one this conversation actually knows about.
 */
const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  [CHECK_AVAILABILITY_TOOL_NAME]: (ctx, args) => executeCheckAvailability(ctx, args),
  [CREATE_APPOINTMENT_TOOL_NAME]: (ctx, args, message, allowed) => executeCreateAppointment(ctx, args, message, allowed),
  [RESCHEDULE_APPOINTMENT_TOOL_NAME]: (ctx, args, message, allowed) => executeRescheduleAppointment(ctx, args, message, allowed),
  [CANCEL_APPOINTMENT_TOOL_NAME]: (ctx, args, message, allowed) => executeCancelAppointment(ctx, args, message, allowed),
}

export { TOOL_DEFINITIONS }

/**
 * Server-controlled execution (spec §"FUNCTION CALLING / STRUCTURED
 * TOOLS"): the model requests a tool by name; this is the single place
 * that name is checked against the whitelist before anything Zod-validates
 * or runs. `currentUserMessage` is threaded through so the mutating tools
 * can apply the confirmation gate against it (confirmation.ts); `allowed`
 * is threaded through so they can reject a target entity that isn't
 * actually this conversation's own (types.ts's AiToolAllowedEntities).
 */
export async function executeTool(
  ctx: AuthContext,
  name: string,
  args: unknown,
  currentUserMessage: string,
  allowed: AiToolAllowedEntities
): Promise<ToolResult> {
  const executor = TOOL_EXECUTORS[name]
  if (!executor) {
    return { success: false, tool: name, errorCode: 'INVALID_INPUT', message: `Unknown tool: ${name}` }
  }
  return executor(ctx, args, currentUserMessage, allowed)
}
