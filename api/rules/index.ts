import type { ApiRequest, ApiResponse } from '../../src/server/types/http'
import { requireAuth } from '../../src/server/middleware/requireAuth'
import { createBusinessRuleSchema, businessRuleCategoryFilterSchema } from '../../src/server/validation/businessRule.schemas'
import { listBusinessRules, createBusinessRule } from '../../src/server/services/businessRuleService'
import { toBusinessRuleDto } from '../../src/server/lib/dto'
import { parseEnumQueryParam } from '../../src/server/lib/query'
import { sendError, ApiError } from '../../src/server/lib/errors'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const ctx = await requireAuth(req)

    if (req.method === 'GET') {
      const activeOnly = req.query.activeOnly !== 'false'
      const category = parseEnumQueryParam(businessRuleCategoryFilterSchema, req.query.category, 'category')
      const rules = await listBusinessRules(ctx, { activeOnly, category })
      res.status(200).json({ rules: rules.map(toBusinessRuleDto) })
      return
    }

    if (req.method === 'POST') {
      const input = createBusinessRuleSchema.parse(req.body)
      const rule = await createBusinessRule(ctx, input)
      res.status(201).json({ rule: toBusinessRuleDto(rule) })
      return
    }

    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
  } catch (err) {
    sendError(res, err)
  }
}
