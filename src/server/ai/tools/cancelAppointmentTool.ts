import type { AuthContext } from '../../types/auth'
import { updateAppointment } from '../../services/appointmentService'
import { toAppointmentDto } from '../../lib/dto'
import { cancelAppointmentToolSchema } from './schemas'
import { toToolFailure, invalidInput, confirmationRequired, forbiddenEntity } from './errors'
import { isExplicitConfirmation } from '../confirmation'
import type { ToolResult, AiToolAllowedEntities } from '../types'

export const CANCEL_APPOINTMENT_TOOL_NAME = 'cancel_appointment'

/**
 * No DELETE, ever (spec §"CANCEL APPOINTMENT") — this is a plain
 * status: CANCELLED update through the existing updateAppointment(),
 * which already enforces the status-transition allow-list (a CANCELLED/
 * COMPLETED/NO_SHOW appointment can't be "cancelled" again in a way that
 * changes anything — assertValidTransition treats same-status as a no-op,
 * and any other terminal starting state correctly rejects). Confirmation
 * is required exactly like create/reschedule, and `allowed.appointmentIds`
 * restricts targets to this conversation's own known appointments — see
 * rescheduleAppointmentTool.ts for the identical rationale.
 */
export async function executeCancelAppointment(
  ctx: AuthContext,
  rawArgs: unknown,
  currentUserMessage: string,
  allowed: AiToolAllowedEntities
): Promise<ToolResult> {
  if (!isExplicitConfirmation(currentUserMessage)) {
    return confirmationRequired(CANCEL_APPOINTMENT_TOOL_NAME)
  }

  const parsed = cancelAppointmentToolSchema.safeParse(rawArgs)
  if (!parsed.success) {
    return invalidInput(CANCEL_APPOINTMENT_TOOL_NAME, 'Invalid cancel_appointment arguments')
  }

  if (!allowed.appointmentIds.includes(parsed.data.appointmentId)) {
    return forbiddenEntity(CANCEL_APPOINTMENT_TOOL_NAME, 'appointmentId is not one of this conversation\'s known appointments')
  }

  try {
    const appointment = await updateAppointment(ctx, parsed.data.appointmentId, { status: 'CANCELLED' })
    return { success: true, tool: CANCEL_APPOINTMENT_TOOL_NAME, data: toAppointmentDto(appointment) }
  } catch (err) {
    return toToolFailure(CANCEL_APPOINTMENT_TOOL_NAME, err)
  }
}
