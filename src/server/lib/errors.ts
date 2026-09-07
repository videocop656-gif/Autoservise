import { ZodError } from 'zod'
import type { ApiResponse } from '../types/http'
import { logger } from './logger'

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

/**
 * Single place that turns any thrown error into a safe API response.
 * Never leaks stack traces, SQL errors, connection strings or file paths to the client.
 */
export function sendError(res: ApiResponse, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } })
    return
  }

  if (err instanceof ZodError) {
    // Object-level refine/superRefine issues (e.g. "at least one field must
    // be provided", "duplicate day") have no field path, so Zod puts them
    // in formErrors rather than fieldErrors. Surface both under `details`
    // so the client can show them even when no single field is at fault.
    const { fieldErrors, formErrors } = err.flatten()
    const details: Record<string, string[]> = {}
    for (const [field, messages] of Object.entries(fieldErrors)) {
      if (messages) details[field] = messages
    }
    if (formErrors.length > 0) {
      details._form = formErrors
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details,
      },
    })
    return
  }

  logger.error('unhandled_error', {
    message: err instanceof Error ? err.message : 'Unknown error',
  })
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
}
