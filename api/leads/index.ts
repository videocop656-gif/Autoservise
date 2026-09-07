import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createLeadSchema, leadStatusFilterSchema, leadSourceFilterSchema } from '../../src/server/validation/lead.schemas'
import { listLeads, createLead } from '../../src/server/services/leadService'
import { toLeadDto } from '../../src/server/lib/dto'
import { parsePagination, buildPaginatedResult } from '../../src/server/lib/pagination'
import { parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

function singleQueryValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const { page, pageSize } = parsePagination(req.query)
      const status = parseEnumQueryParam(leadStatusFilterSchema, req.query.status, 'status')
      const source = parseEnumQueryParam(leadSourceFilterSchema, req.query.source, 'source')
      const customerId = singleQueryValue(req.query.customerId)
      const vehicleId = singleQueryValue(req.query.vehicleId)
      const serviceId = singleQueryValue(req.query.serviceId)
      const search = singleQueryValue(req.query.search)?.trim() || undefined

      const { items, total } = await listLeads(ctx, {
        page,
        pageSize,
        status,
        source,
        customerId,
        vehicleId,
        serviceId,
        search,
      })
      res.status(200).json(buildPaginatedResult(items.map(toLeadDto), page, pageSize, total))
      return
    }

    if (req.method === 'POST') {
      const input = createLeadSchema.parse(req.body)
      const lead = await createLead(ctx, input)
      res.status(201).json({ lead: toLeadDto(lead) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
