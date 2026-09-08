import type { AuthContext } from '../../types/auth'
import { updateAppointment } from '../../services/appointmentService'
import { toAppointmentDto } from '../../lib/dto'
import { rescheduleAppointmentToolSchema } from './schemas'
import { toToolFailure, invalidInput, confirmationRequired, forbiddenEntity } from './errors'
import { isExplicitConfirmation } from '../confirmation'
import type { ToolResult, AiToolAllowedEntities } from '../types'

export const RESCHEDULE_APPOINTMENT_TOOL_NAME = 'reschedule_appointment'

/**
 * Reuses the real updateAppointment() unchanged — tenant-scoped lookup,
 * the terminal-status guard (Prompt 10 addition to appointmentService.ts:
 * a COMPLETED/CANCELLED/NO_SHOW appointment can never have its time
 * changed), working-hours/duration re-validation, and conflict re-check
 * excluding the appointment's own current slot, all for free. Confirmation
 * is required exactly like create_appointment — a model deciding to call
 * this tool is never itself sufficient authorization.
 *
 * `allowed.appointmentIds` restricts this to appointments the AI was
 * actually told about for this conversation (upcomingAppointments in the
 * business context) — an id the model supplies that isn't in that list is
 * rejected as FORBIDDEN even if it's a real appointment belonging to this
 * same tenant, since it isn't one this conversation has any business
 * touching (spec: "AI must not control IDs arbitrarily").
 */
export async function executeRescheduleAppointment(
  ctx: AuthContext,
  rawArgs: unknown,
  currentUserMessage: string,
  allowed: AiToolAllowedEntities
): Promise<ToolResult> {
  if (!isExplicitConfirmation(currentUserMessage)) {
    return confirmationRequired(RESCHEDULE_APPOINTMENT_TOOL_NAME)
  }

  const parsed = rescheduleAppointmentToolSchema.safeParse(rawArgs)
  if (!parsed.success) {
    return invalidInput(RESCHEDULE_APPOINTMENT_TOOL_NAME, 'Invalid reschedule_appointment arguments')
  }

  if (!allowed.appointmentIds.includes(parsed.data.appointmentId)) {
    return forbiddenEntity(RESCHEDULE_APPOINTMENT_TOOL_NAME, 'appointmentId is not one of this conversation\'s known appointments')
  }

  try {
    const appointment = await updateAppointment(ctx, parsed.data.appointmentId, {
      startAt: parsed.data.startAt,
      endAt: parsed.data.endAt,
    })
    return { success: true, tool: RESCHEDULE_APPOINTMENT_TOOL_NAME, data: toAppointmentDto(appointment) }
  } catch (err) {
    return toToolFailure(RESCHEDULE_APPOINTMENT_TOOL_NAME, err)
  }
}
