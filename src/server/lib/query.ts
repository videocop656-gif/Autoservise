import type { z } from 'zod'
import { ApiError } from './errors'

/**
 * Parses an optional single-value query param (e.g. ?category=FAQ) against a
 * Zod schema. Returns undefined when the param is absent (meaning "no
 * filter"), and throws a VALIDATION_ERROR if it's present but doesn't match
 * — an unrecognized category should be a clear 400, not silently ignored.
 */
export function parseEnumQueryParam<T extends z.ZodTypeAny>(
  schema: T,
  raw: string | string[] | undefined,
  fieldName: string
): z.infer<T> | undefined {
  if (raw === undefined) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${fieldName}`)
  }
  return result.data
}

/** Parses an optional ISO 8601 date/datetime query param (e.g. ?dateFrom=...). Throws 400 if present but unparseable. */
export function parseDateQueryParam(raw: string | string[] | undefined, fieldName: string): Date | undefined {
  if (raw === undefined) return undefined
  const value = Array.isArray(raw) ? raw[0] : raw
  const date = new Date(value ?? '')
  if (!value || Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Invalid ${fieldName}`)
  }
  return date
}
