import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createCustomerSchema } from '../../src/server/validation/customer.schemas'
import { listCustomers, createCustomer } from '../../src/server/services/customerService'
import { toCustomerDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const activeOnly = req.query.includeInactive !== 'true'
      const search = singleQueryValue(req.query.search)?.trim() || undefined

      const { items, total } = await listCustomers(ctx, { page, pageSize, activeOnly, search })
      res.status(200).json(buildPaginatedResult(items.map(toCustomerDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createCustomerSchema.parse(req.body)
      const customer = await createCustomer(ctx, input)
      res.status(201).json({ customer: toCustomerDto(customer) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
