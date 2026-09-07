import { z } from 'zod'
import { ApiError } from './errors'

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export interface PaginationParams {
  page: number
  pageSize: number
}

/** Parses ?page=&pageSize= from a query object, applying defaults (1/20) and bounds (1<=pageSize<=100). */
export function parsePagination(query: Record<string, string | string[] | undefined>): PaginationParams {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const result = paginationQuerySchema.safeParse({ page: pick(query.page), pageSize: pick(query.pageSize) })
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid pagination parameters')
  }
  return result.data
}

export interface PaginatedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function buildPaginatedResult<T>(items: T[], page: number, pageSize: number, total: number): PaginatedResult<T> {
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
}
