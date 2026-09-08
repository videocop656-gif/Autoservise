import type { AuthContext } from '../../types/auth'
import { checkAvailability } from '../../services/appointmentService'
import { checkAvailabilityToolSchema } from './schemas'
import { toToolFailure, invalidInput } from './errors'
import type { ToolResult } from '../types'

export const CHECK_AVAILABILITY_TOOL_NAME = 'check_availability'

/**
 * Read-only — never requires confirmation (spec: only create/reschedule/
 * cancel are gated). Delegates every rule to
 * appointmentService.checkAvailability(), which is the single source of
 * truth for working hours/timezone/conflict/duration — nothing here
 * duplicates that logic.
 */
export async function executeCheckAvailability(ctx: AuthContext, rawArgs: unknown): Promise<ToolResult> {
  const parsed = checkAvailabilityToolSchema.safeParse(rawArgs)
  if (!parsed.success) {
    return invalidInput(CHECK_AVAILABILITY_TOOL_NAME, 'Invalid check_availability arguments')
  }

  try {
    const result = await checkAvailability(ctx, parsed.data)
    return {
      success: true,
      tool: CHECK_AVAILABILITY_TOOL_NAME,
      data: {
        available: result.slots.length > 0,
        date: result.date,
        timezone: result.timezone,
        // Never a raw Prisma/internal object — a hand-picked DTO shape,
        // same principle as every other tool result and every DTO in
        // src/server/lib/dto.ts.
        slots: result.slots.map((slot) => ({
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          localStart: slot.localStart,
          localEnd: slot.localEnd,
        })),
      },
    }
  } catch (err) {
    return toToolFailure(CHECK_AVAILABILITY_TOOL_NAME, err)
  }
}
