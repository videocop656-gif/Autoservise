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
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten().fieldErrors,
      },
    })
    return
  }

  logger.error('unhandled_error', {
    message: err instanceof Error ? err.message : 'Unknown error',
  })
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } })
}
